const jwt = require('jsonwebtoken');
const { poolPromise, sql } = require('../config/db');
const LDAPService = require('../services/ldapService');
const { logAction } = require('../services/auditService');
const { removeSession } = require('../middleware/tokenExpiry');
const crypto = require('crypto');

// Helper to get client IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.ip ||
        'unknown';
};

/** Genuine bad-login (never retry). Connection problems are retryable. */
function isTransientError(err) {
    if (!err) return false;
    if (err.code === 49 || err.name === 'InvalidCredentialsError') return false;
    if (err.isTransient === true) return true;

    const netCodes = [
        'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
        'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EAI_AGAIN', 'ECONNABORTED'
    ];
    if (netCodes.includes(err.code)) return true;
    if (/Timeout|Connect|Unavailable|Busy|ServerDown/i.test(err.name || '')) return true;
    return false;
}

/** Map an AD failure to a clear message using its embedded sub-code. */
function describeAdError(err) {
    const msg = err.message || '';
    if (/525/.test(msg)) return 'User does not exist in Active Directory';
    if (/52e/.test(msg)) return 'Invalid Active Directory credentials';
    if (/530/.test(msg)) return 'Not permitted to log on at this time';
    if (/531/.test(msg)) return 'Not permitted to log on from this workstation';
    if (/532/.test(msg)) return 'Active Directory password has expired';
    if (/533/.test(msg)) return 'Active Directory account is disabled';
    if (/701/.test(msg)) return 'Active Directory account has expired';
    if (/773/.test(msg)) return 'Password must be changed before logging in';
    if (/775/.test(msg)) return 'Active Directory account is locked out';
    return 'Invalid Active Directory credentials';
}

/** Authenticate with a light retry — transient only, genuine failures fail fast. */
async function authenticateWithRetry(employee_id, password, maxAttempts = 2, baseDelayMs = 500) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const adUser = await LDAPService.authenticate(employee_id, password);
            if (attempt > 1) console.log(`✅ AD AUTH SUCCESS on retry (attempt ${attempt})`);
            return adUser;
        } catch (err) {
            lastErr = err;
            if (!isTransientError(err)) throw err;
            console.warn(`⚠️ AD transient failure (attempt ${attempt}/${maxAttempts}): ${err.code || err.name || err.message}`);
            if (attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, baseDelayMs * attempt));
            }
        }
    }
    throw lastErr;
}

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

    let adUser;

    // STEP 1: AUTHENTICATE AGAINST AD
    try {
        adUser = await authenticateWithRetry(employee_id, password);
        console.log("✅ AD AUTH SUCCESS");
        console.log("AD USER:", adUser);
    } catch (err) {
        const transient = isTransientError(err);

        console.error('❌ AD LOGIN ERROR:', {
            message: err.message,
            code: err.code,
            name: err.name,
            isTransient: transient,
            cause: err.cause && err.cause.message
        });

        if (transient) {
            await logAction(
                req, 'LOGIN_FAILED', 'USER', employee_id, null,
                {
                    employee_id,
                    reason: 'Active Directory unreachable (transient)',
                    error: (err.cause && err.cause.message) || err.message,
                    ip: ip_address
                },
                null,
                { email: employee_id, name: employee_id }
            );
            return res.status(503).json({
                success: false,
                message: 'Active Directory is temporarily unavailable. Please try again in a moment.'
            });
        }

        const reason = describeAdError(err);
        await logAction(
            req, 'LOGIN_FAILED', 'USER', employee_id, null,
            { employee_id, reason, error: err.message, ip: ip_address },
            null,
            { email: employee_id, name: employee_id }
        );
        return res.status(401).json({ success: false, message: reason });
    }

    // STEP 2+: DB lookup, session, JWT, tracking, audit.
    try {
        const pool = await poolPromise;

        // ✅ UPDATED QUERY: Join with roles table to get proper role name
        const result = await pool.request()
            .input('employee_id', sql.NVarChar, adUser.employee_id)
            .query(`
                SELECT 
                    u.id, 
                    u.employee_id, 
                    u.email, 
                    u.name, 
                    u.department, 
                    u.branch,
                    u.created_at, 
                    u.last_login, 
                    u.total_active_seconds, 
                    u.login_count, 
                    u.is_online,
                    u.role_id,
                    COALESCE(r.name, 'IT User') as role
                FROM Users u
                LEFT JOIN roles r ON u.role_id = r.id
                WHERE u.employee_id = @employee_id
            `);

        const dbUser = result.recordset[0];
        console.log("DB USER:", dbUser);

        if (!dbUser) {
            console.log(`❌ Employee ID not found in DB: ${adUser.employee_id}`);
            await logAction(
                req, 'LOGIN_FAILED', 'USER', adUser.employee_id, null,
                {
                    employee_id: adUser.employee_id,
                    reason: 'User authenticated in AD but not registered in PMS',
                    email: adUser.email
                },
                { email: adUser.email || adUser.employee_id, name: adUser.name || adUser.employee_id }
            );
            return res.status(403).json({
                success: false,
                message: 'User authenticated in Active Directory but not registered in PMS'
            });
        }

        // STEP 3: GENERATE JWT with proper role
        const token = jwt.sign(
            {
                id: dbUser.id,
                employee_id: dbUser.employee_id,
                email: dbUser.email,
                role: dbUser.role,  // This will be 'Super Admin', 'Admin', 'IT User', etc.
                role_id: dbUser.role_id,
                name: dbUser.name,
                department: dbUser.department,
                branch: dbUser.branch,
                authMethod: 'active_directory'
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // STEP 3.5: GENERATE SESSION TOKEN
        const sessionToken = crypto.randomBytes(64).toString('hex');

        // Ensure UserSessions table exists
        try {
            await pool.request().query(`
                IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'UserSessions')
                BEGIN
                    CREATE TABLE UserSessions (
                        id INT PRIMARY KEY IDENTITY(1,1),
                        user_id INT NOT NULL,
                        session_token VARCHAR(255) NOT NULL UNIQUE,
                        login_at DATETIME NOT NULL,
                        logout_at DATETIME NULL,
                        ip_address VARCHAR(45) NULL,
                        user_agent TEXT NULL,
                        session_duration_seconds INT DEFAULT 0,
                        created_at DATETIME DEFAULT GETDATE(),
                        FOREIGN KEY (user_id) REFERENCES Users(id)
                    );
                    CREATE INDEX IX_UserSessions_user_id ON UserSessions(user_id);
                    CREATE INDEX IX_UserSessions_session_token ON UserSessions(session_token);
                END
            `);
        } catch (tableErr) {
            console.log('UserSessions table might already exist or error:', tableErr.message);
        }

        // Insert new session (UTC)
        try {
            await pool.request()
                .input('userId', sql.Int, dbUser.id)
                .input('sessionToken', sql.NVarChar, sessionToken)
                .input('ipAddress', sql.NVarChar, ip_address)
                .input('userAgent', sql.NVarChar, req.headers['user-agent'] || 'Unknown')
                .query(`
                    INSERT INTO UserSessions (user_id, session_token, login_at, ip_address, user_agent)
                    VALUES (@userId, @sessionToken, GETUTCDATE(), @ipAddress, @userAgent)
                `);
            console.log(`✅ Session created for user ${dbUser.id}`);
        } catch (sessionErr) {
            console.error('Failed to create session:', sessionErr);
        }

        // STEP 4: UPDATE LOGIN TRACKING (UTC)
        await pool.request()
            .input('id', sql.Int, dbUser.id)
            .query(`
                UPDATE Users
                SET last_login = GETUTCDATE(),
                    login_count = ISNULL(login_count, 0) + 1,
                    is_online = 1
                WHERE id = @id
            `);

        // STEP 5: AUDIT SUCCESSFUL LOGIN
        const userForAudit = {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            role: dbUser.role
        };

        await logAction(
            req, 'LOGIN', 'USER', dbUser.id, null,
            {
                employee_id: dbUser.employee_id,
                email: dbUser.email,
                role: dbUser.role,
                name: dbUser.name,
                department: dbUser.department,
                branch: dbUser.branch,
                role_id: dbUser.role_id,
                login_time: new Date().toISOString(),
                ip: ip_address,
                login_count: (dbUser.login_count || 0) + 1,
                session_token: sessionToken.substring(0, 16) + '...'
            },
            null,
            userForAudit
        );

        console.log(`✅ LOGIN SUCCESS: ${dbUser.employee_id} (${dbUser.role})`);

        // ✅ Determine redirect based on role
        const isAdminRole = dbUser.role === 'Super Admin' || dbUser.role === 'Admin';
        const redirectTo = isAdminRole ? '/admin' : '/dashboard';

        return res.status(200).json({
            success: true,
            token,
            sessionToken,
            user: {
                id: dbUser.id,
                employee_id: dbUser.employee_id,
                email: dbUser.email,
                name: dbUser.name,
                role: dbUser.role,
                role_id: dbUser.role_id,
                department: dbUser.department,
                branch: dbUser.branch,
                last_login: dbUser.last_login,
                login_count: (dbUser.login_count || 0) + 1,
                total_active_seconds: dbUser.total_active_seconds || 0
            },
            redirectTo: redirectTo
        });

    } catch (err) {
        console.error('❌ POST-AUTH (DB/SESSION) ERROR:', err);
        await logAction(
            req, 'LOGIN_FAILED', 'USER', employee_id, null,
            { employee_id, reason: 'Internal error after AD authentication', error: err.message, ip: ip_address },
            null,
            { email: employee_id, name: employee_id }
        );
        return res.status(500).json({
            success: false,
            message: 'Login succeeded against Active Directory but failed while completing sign-in. Please try again.'
        });
    }
};

// Logout endpoint - tracks logout and calculates active session time
exports.logout = async (req, res) => {
    try {
        const pool = await poolPromise;
        const sessionToken = req.headers['x-session-token'];

        if (sessionToken) {
            await pool.request()
                .input('sessionToken', sql.NVarChar, sessionToken)
                .query(`
                    UPDATE UserSessions 
                    SET logout_at = GETUTCDATE(),
                        session_duration_seconds = DATEDIFF(SECOND, login_at, GETUTCDATE())
                    WHERE session_token = @sessionToken AND logout_at IS NULL
                `);
        }

        const userResult = await pool.request()
            .input('id', sql.Int, req.user.id)
            .query(`SELECT last_login, total_active_seconds, login_count FROM Users WHERE id = @id`);

        const user = userResult.recordset[0];
        let sessionDuration = 0;

        if (user && user.last_login) {
            const durationResult = await pool.request()
                .input('id', sql.Int, req.user.id)
                .query(`SELECT DATEDIFF(SECOND, last_login, GETUTCDATE()) as session_duration FROM Users WHERE id = @id`);

            sessionDuration = durationResult.recordset[0]?.session_duration || 0;
            const newTotalSeconds = (user.total_active_seconds || 0) + sessionDuration;

            await pool.request()
                .input('id', sql.Int, req.user.id)
                .input('total_seconds', sql.Int, newTotalSeconds)
                .query(`
                    UPDATE Users 
                    SET last_logout = GETUTCDATE(),
                        total_active_seconds = @total_seconds,
                        is_online = 0
                    WHERE id = @id
                `);
        } else {
            await pool.request()
                .input('id', sql.Int, req.user.id)
                .query(`UPDATE Users SET last_logout = GETUTCDATE(), is_online = 0 WHERE id = @id`);
        }

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
                ip: getClientIp(req),
                session_token: sessionToken ? sessionToken.substring(0, 16) + '...' : null
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