// middleware/activityTracker.js
const { poolPromise, sql } = require('../config/db');

// Store user last activity times in memory
const userActivity = new Map();

// Clean up old entries every hour
setInterval(() => {
    const now = Date.now();
    for (const [userId, data] of userActivity.entries()) {
        if (now - data.lastUpdate > 3600000) { // Remove after 1 hour
            userActivity.delete(userId);
        }
    }
}, 3600000);

// Update user activity timestamp
const updateUserActivity = async (userId) => {
    const now = Date.now();
    userActivity.set(userId, {
        lastActivity: now,
        lastUpdate: now
    });
    
    // Also update in database (optional, can be commented out for performance)
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('userId', sql.Int, userId)
            .input('now', sql.DateTime, new Date(now))
            .query(`
                UPDATE Users 
                SET last_activity_at = @now
                WHERE id = @userId
            `);
    } catch (err) {
        // Don't fail the request if DB update fails
        console.error('Error updating activity in DB:', err.message);
    }
};

// Check if user session is expired due to inactivity
const isSessionExpired = (userId, inactivityTimeoutMs = 10 * 60 * 1000) => {
    const userData = userActivity.get(userId);
    if (!userData) {
        // No activity record yet - consider it active (first request)
        return false;
    }
    
    const now = Date.now();
    const expired = (now - userData.lastActivity) > inactivityTimeoutMs;
    if (expired) {
        console.log(`User ${userId} inactivity expired: ${Math.floor((now - userData.lastActivity) / 1000)}s since last activity`);
    }
    return expired;
};

// Middleware to track user activity on every request
const trackActivity = async (req, res, next) => {
    // Skip tracking for login, logout, and ping endpoints
    const skipPaths = ['/api/auth/login', '/api/auth/logout', '/api/auth/ping'];
    if (skipPaths.includes(req.path)) {
        return next();
    }
    
    if (req.user && req.user.id) {
        await updateUserActivity(req.user.id);
    }
    next();
};

// Middleware to check inactivity and expire session
const checkInactivity = async (req, res, next) => {
    // Skip check for login, logout, and ping endpoints
    const skipPaths = ['/api/auth/login', '/api/auth/logout', '/api/auth/ping'];
    if (skipPaths.includes(req.path)) {
        return next();
    }
    
    if (!req.user || !req.user.id) {
        return next();
    }
    
    const isExpired = isSessionExpired(req.user.id);
    
    if (isExpired) {
        // Session expired due to inactivity
        console.log(`⏰ User ${req.user.email} session expired due to inactivity`);
        
        // Update database to mark offline
        try {
            const pool = await poolPromise;
            await pool.request()
                .input('userId', sql.Int, req.user.id)
                .query(`
                    UPDATE Users 
                    SET is_online = 0,
                        last_logout = GETDATE()
                    WHERE id = @userId AND is_online = 1
                `);
        } catch (err) {
            console.error('Error updating inactive user:', err.message);
        }
        
        // Clear activity record
        userActivity.delete(req.user.id);
        
        return res.status(401).json({
            success: false,
            message: 'Session expired due to inactivity. Please login again.',
            code: 'INACTIVITY_EXPIRED'
        });
    }
    
    next();
};

// Reset session timer (called on user activity)
const resetSessionTimer = async (userId) => {
    await updateUserActivity(userId);
    console.log(`🔄 Session timer reset for user ${userId}`);
};

// Get user's remaining session time
const getRemainingSessionTime = (userId) => {
    const userData = userActivity.get(userId);
    if (!userData) return 10 * 60 * 1000; // Return full timeout if no record
    
    const now = Date.now();
    const elapsed = now - userData.lastActivity;
    const remaining = Math.max(0, 10 * 60 * 1000 - elapsed);
    return remaining;
};

// Initialize user activity on login
const initUserActivity = async (userId) => {
    await updateUserActivity(userId);
    console.log(`✅ User ${userId} activity tracking initialized`);
};

module.exports = {
    trackActivity,
    checkInactivity,
    updateUserActivity,
    isSessionExpired,
    getRemainingSessionTime,
    resetSessionTimer,
    initUserActivity,
    userActivity
};