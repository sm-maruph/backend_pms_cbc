const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');
const LDAPService = require('../services/ldapService');
const { logAction } = require('../services/auditService');


// Helper to get client IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.ip ||
        'unknown';
};


exports.login = async (req, res) => {

    console.log("🔥 LOGIN BODY:", req.body);

    const { employee_id, password } = req.body;
    const ip_address = getClientIp(req);

    if (!employee_id || !password) {
        return res.status(400).json({
            success: false,
            message: 'Employee ID and password are required'
        });
    }

    try {

        // =====================================
        // STEP 1: AUTHENTICATE AGAINST AD
        // =====================================
        const adUser = await LDAPService.authenticate(
            employee_id,
            password
        );

        console.log("✅ AD AUTH SUCCESS");
        console.log("AD USER:", adUser);

        // =====================================
        // STEP 2: FIND USER IN MSSQL
        // MATCH EXACT EMPLOYEE ID
        // =====================================
        const pool = await poolPromise;

        const result = await pool.request()
            .input(
                'employee_id',
                sql.NVarChar,
                adUser.employee_id
            )
            .query(`
                SELECT
                    id,
                    employee_id,
                    email,
                    name,
                    role,
                    department,
                    branch,
                    created_at, last_login, total_active_seconds, login_count, is_online
                FROM Users
                WHERE employee_id = @employee_id
            `);

        const dbUser = result.recordset[0];
        console.log("DB RESULT:", result.recordset);
        console.log("DB USER:", dbUser);

        if (!dbUser) {

            console.log(
                `❌ Employee ID not found in DB: ${adUser.employee_id}`
            );
            // Log failed login - AD success but user not in DB
            await logAction(
                req,
                'LOGIN_FAILED',
                'USER',
                adUser.employee_id,
                null,
                {
                    employee_id: adUser.employee_id,
                    reason: 'User authenticated in AD but not registered in PMS',
                    email: adUser.email
                },
                { email: adUser.email || adUser.employee_id, name: adUser.name || adUser.employee_id }
            );

            return res.status(403).json({
                success: false,
                message:
                    'User authenticated in Active Directory but not registered in PMS'
            });
        }


        // =====================================
        // STEP 3: GENERATE JWT
        // =====================================

        const token = jwt.sign(
            {
                id: dbUser.id,
                employee_id: dbUser.employee_id,
                email: dbUser.email,
                role: dbUser.role,
                name: dbUser.name,
                department: dbUser.department,
                branch: dbUser.branch,
                authMethod: 'active_directory'
            },
            process.env.JWT_SECRET,
            { expiresIn: '4h' }
        );

        // =====================================
        // STEP 4: UPDATE LOGIN TRACKING
        // =====================================

        // Calculate previous session duration if there was a last_login
        let previousSessionDuration = null;
        if (dbUser.last_login && dbUser.is_online === 0) {
            // User was offline, calculate duration from last_login to last_logout
            // This is handled separately
        }

        // Update user login tracking
        await pool.request()
            .input('id', sql.Int, dbUser.id)
            .input('now', sql.DateTime, new Date())
            .query(`
                UPDATE Users 
                SET last_login = @now,
                    login_count = ISNULL(login_count, 0) + 1,
                    is_online = 1
                WHERE id = @id
            `);


        // =====================================
        // STEP 5: LOG SUCCESSFUL LOGIN TO AUDIT
        // =====================================

        const userForAudit = {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            role: dbUser.role
        };

        await logAction(
            req,
            'LOGIN',
            'USER',
            dbUser.id,
            null,
            {
                employee_id: dbUser.employee_id,
                email: dbUser.email,
                role: dbUser.role,
                name: dbUser.name,
                department: dbUser.department,
                branch: dbUser.branch,
                login_time: new Date().toISOString(),
                ip: ip_address,
                login_count: (dbUser.login_count || 0) + 1
            },
            null,
            userForAudit
        );
        // =====================================
        // STEP 6: RESPONSE
        // =====================================

        console.log(`✅ LOGIN SUCCESS: ${dbUser.employee_id} (${dbUser.role})`);

        return res.status(200).json({
            success: true,
            token,
            user: {
                id: dbUser.id,
                employee_id: dbUser.employee_id,
                email: dbUser.email,
                name: dbUser.name,
                role: dbUser.role,
                department: dbUser.department,
                branch: dbUser.branch,
                last_login: dbUser.last_login,
                login_count: (dbUser.login_count || 0) + 1,
                total_active_seconds: dbUser.total_active_seconds || 0
            },
            redirectTo: dbUser.role?.toLowerCase() === 'admin' ? '/admin' : '/dashboard'
        });

    } catch (err) {

        console.error('❌ LOGIN ERROR:', err);

        await logAction(
            req,
            'LOGIN_FAILED',
            'USER',
            employee_id,
            null,
            {
                employee_id: employee_id,
                reason: err.message || 'Invalid Active Directory credentials',
                error: err.message,
                ip: ip_address
            },
            null,
            { email: employee_id, name: employee_id }
        );

        return res.status(401).json({
            success: false,
            message: err.message || 'Invalid Active Directory credentials'
        });
    }
};

// Logout endpoint - tracks logout and calculates active session time
exports.logout = async (req, res) => {
    try {
        const pool = await poolPromise;

        // Get user's last login time
        const userResult = await pool.request()
            .input('id', sql.Int, req.user.id)
            .query(`
                SELECT last_login, total_active_seconds, login_count 
                FROM Users WHERE id = @id
            `);

        const user = userResult.recordset[0];
        let sessionDuration = 0;

        if (user && user.last_login) {
            const lastLogin = new Date(user.last_login);
            const now = new Date();
            sessionDuration = Math.floor((now - lastLogin) / 1000); // seconds

            // Update total active seconds
            const newTotalSeconds = (user.total_active_seconds || 0) + sessionDuration;

            await pool.request()
                .input('id', sql.Int, req.user.id)
                .input('now', sql.DateTime, now)
                .input('session_duration', sql.Int, sessionDuration)
                .input('total_seconds', sql.Int, newTotalSeconds)
                .query(`
                    UPDATE Users 
                    SET last_logout = @now,
                        total_active_seconds = @total_seconds,
                        is_online = 0
                    WHERE id = @id
                `);
        } else {
            await pool.request()
                .input('id', sql.Int, req.user.id)
                .input('now', sql.DateTime, new Date())
                .query(`
                    UPDATE Users 
                    SET last_logout = @now,
                        is_online = 0
                    WHERE id = @id
                `);
        }

        // Log the logout action
        await logAction(
            req,
            'LOGOUT',
            'USER',
            req.user.id,
            null,
            {
                employee_id: req.user.employee_id,
                email: req.user.email,
                role: req.user.role,
                name: req.user.name,
                logout_time: new Date().toISOString(),
                session_duration_seconds: sessionDuration,
                session_duration_formatted: formatDuration(sessionDuration),
                total_active_seconds: (user?.total_active_seconds || 0) + sessionDuration,
                ip: getClientIp(req)
            },
            null,
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        console.log(`✅ LOGOUT: ${req.user.email} logged out. Session duration: ${formatDuration(sessionDuration)}`);

        res.json({
            success: true,
            message: 'Logged out successfully',
            session_duration: sessionDuration,
            session_duration_formatted: formatDuration(sessionDuration)
        });

    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            message: 'Error during logout'
        });
    }
};

// Helper function to format duration
function formatDuration(seconds) {
    if (seconds < 60) return `${seconds} seconds`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    return `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes > 1 ? 's' : ''}`;
}