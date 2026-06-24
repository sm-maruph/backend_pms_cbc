// middleware/tokenExpiry.js
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');

// Track active sessions in memory (or use Redis in production)
const activeSessions = new Map();

// Clean up expired sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of activeSessions.entries()) {
        if (session.expiry < now) {
            // Session expired, clean up user online status
            handleTokenExpiry(session.userId, session.token);
            activeSessions.delete(token);
        }
    }
}, 60000); // Check every minute

async function handleTokenExpiry(userId, token) {
    try {
        const pool = await poolPromise;
        
        // Check if user has any other active sessions
        let hasOtherActiveSession = false;
        for (const [otherToken, session] of activeSessions.entries()) {
            if (session.userId === userId && otherToken !== token && session.expiry > Date.now()) {
                hasOtherActiveSession = true;
                break;
            }
        }
        
        // Only mark offline if no other active sessions
        if (!hasOtherActiveSession) {
            await pool.request()
                .input('id', sql.Int, userId)
                .query(`
                    UPDATE Users 
                    SET is_online = 0,
                        last_logout = GETDATE()
                    WHERE id = @id AND is_online = 1
                `);
            
            // Log to audit
            const { logAction } = require('../services/auditService');
            const mockReq = { 
                user: { id: userId },
                headers: {},
                ip: 'system'
            };
            
            await logAction(
                mockReq,
                'LOGOUT',
                'USER',
                userId,
                null,
                {
                    reason: 'Token expired',
                    user_id: userId,
                    logout_time: new Date().toISOString()
                },
                { reason: 'Token expired automatically' },
                { id: userId }
            );
            
            console.log(`✅ Token expired for user ${userId}, marked as offline`);
        }
    } catch (error) {
        console.error('Error handling token expiry:', error);
    }
}

// Middleware to track token expiry
const trackTokenExpiry = async (req, res, next) => {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return next();
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Store or update session
        activeSessions.set(token, {
            userId: decoded.id,
            expiry: decoded.exp * 1000,
            token: token
        });
        
        next();
    } catch (err) {
        // Token might be expired, handle cleanup
        if (err.name === 'TokenExpiredError') {
            // Try to get user from token payload
            const decoded = jwt.decode(token);
            if (decoded && decoded.id) {
                await handleTokenExpiry(decoded.id, token);
            }
        }
        next();
    }
};

// Function to remove session on logout
const removeSession = (token) => {
    activeSessions.delete(token);
};

module.exports = { trackTokenExpiry, removeSession, handleTokenExpiry };