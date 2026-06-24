// middleware/auth.js
const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');
const { isSessionExpired } = require('./activityTracker');

const authenticateToken = async (req, res, next) => {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check inactivity expiry
        if (isSessionExpired(decoded.id)) {
            console.log(`⏰ Inactivity timeout for user: ${decoded.email}`);
            try {
                const pool = await poolPromise;
                await pool.request()
                    .input('userId', sql.Int, decoded.id)
                    .query(`
                        UPDATE Users 
                        SET is_online = 0,
                            last_logout = GETDATE()
                        WHERE id = @userId AND is_online = 1
                    `);
            } catch (err) {
                console.error('Error updating inactive user:', err);
            }
            return res.status(401).json({ 
                message: 'Session expired due to inactivity. Please login again.',
                code: 'INACTIVITY_EXPIRED'
            });
        }
        
        // ✅ Fetch user from database to get the latest role
        try {
            const pool = await poolPromise;
            const userResult = await pool.request()
                .input('userId', sql.Int, decoded.id)
                .query(`
                    SELECT u.id, u.email, u.name, u.employee_id, u.department, u.branch, 
                           u.role_id, COALESCE(r.name, 'IT User') as role
                    FROM users u
                    LEFT JOIN roles r ON u.role_id = r.id
                    WHERE u.id = @userId
                `);
            
            if (userResult.recordset.length > 0) {
                const dbUser = userResult.recordset[0];
                req.user = {
                    id: dbUser.id,
                    email: dbUser.email,
                    name: dbUser.name,
                    employee_id: dbUser.employee_id,
                    department: dbUser.department,
                    branch: dbUser.branch,
                    role_id: dbUser.role_id,
                    role: dbUser.role  // 'Super Admin', 'Admin', 'IT User', etc.
                };
            } else {
                req.user = decoded;
            }
        } catch (dbErr) {
            console.error('Error fetching user details:', dbErr);
            req.user = decoded;
        }
        
        // console.log('✅ Authenticated user:', { 
        //     email: req.user.email, 
        //     role: req.user.role,
        //     role_id: req.user.role_id 
        // });
        
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'Token expired. Please login again.', code: 'TOKEN_EXPIRED' });
        }
        console.error('❌ Invalid token:', err.message);
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

module.exports = authenticateToken;