const { poolPromise, sql } = require('../config/db');
const { logAction } = require('../services/auditService');

// Helper to get client IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.ip ||
        'unknown';
};

// Returns ONLY id, email, name (no role, department, branch, created_at)
const getBasicUsers = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT id, email, name 
            FROM Users 
            ORDER BY name
        `);
        console.log('✅ Basic users fetched:', result.recordset.length);
        res.json(result.recordset);
    } catch (err) {
        console.error('❌ Error fetching basic users:', err);
        res.status(500).json({ message: 'Error fetching users' });
    }
};

// Returns ALL user data (for admin dashboard)
const getAllUsers = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                id, email, name, role, role_id, department, branch, created_at, 
                employee_id, 
                is_online, 
                last_login,
                last_logout,
                ISNULL(login_count, 0) as login_count,
                ISNULL(total_active_seconds, 0) as total_active_seconds,
                pabx_extension,
                mobile_number
            FROM Users 
            ORDER BY name
        `);
        console.log('✅ All users fetched:', result.recordset.length);
        res.json(result.recordset);
    } catch (err) {
        console.error('❌ Error fetching all users:', err);
        res.status(500).json({ message: 'Error fetching users' });
    }
};

// Create user (admin only) - NO PASSWORD (AD authenticated)
const createUser = async (req, res) => {
    const {
        email,
        name,
        role,
        department,
        branch,
        employee_id,
        pabx_extension,
        mobile_number
    } = req.body;
    const ip_address = getClientIp(req);

    if (!email || !name) {
        return res.status(400).json({
            message: 'Email and name are required'
        });
    }

    try {
        const pool = await poolPromise;

        // Check if email already exists
        const checkEmail = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT id FROM Users WHERE email = @email');

        if (checkEmail.recordset.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // Check if employee_id already exists (if provided)
        if (employee_id) {
            const checkEmployee = await pool.request()
                .input('employee_id', sql.NVarChar, employee_id)
                .query('SELECT id FROM Users WHERE employee_id = @employee_id');

            if (checkEmployee.recordset.length > 0) {
                return res.status(400).json({ message: 'Employee ID already exists' });
            }
        }

        // Insert new user (NO PASSWORD - AD authenticated)
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .input('name', sql.NVarChar, name)
            .input('role', sql.NVarChar, role || 'user')
            .input('department', sql.NVarChar, department || null)
            .input('branch', sql.NVarChar, branch || null)
            .input('employee_id', sql.NVarChar, employee_id || null)
            .input('pabx_extension', sql.NVarChar, pabx_extension || null)
            .input('mobile_number', sql.NVarChar, mobile_number || null)
            .query(`
                INSERT INTO Users (
                    email, name, role, department, branch, employee_id, 
                    pabx_extension, mobile_number, created_at
                )
                OUTPUT INSERTED.id, INSERTED.email, INSERTED.name, INSERTED.role, 
                       INSERTED.department, INSERTED.branch, INSERTED.employee_id, 
                       INSERTED.pabx_extension, INSERTED.mobile_number, INSERTED.created_at
                VALUES (
                    @email, @name, @role, @department, @branch, @employee_id,
                    @pabx_extension, @mobile_number, GETUTCDATE()
                )
            `);

        const newUser = result.recordset[0];

        // LOG: User creation
        await logAction(
            req,
            'CREATE',
            'USER',
            newUser.id,
            null,
            {
                id: newUser.id,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role,
                department: newUser.department,
                branch: newUser.branch,
                employee_id: newUser.employee_id,
                pabx_extension: newUser.pabx_extension,
                mobile_number: newUser.mobile_number,
                created_at: newUser.created_at
            },
            {
                action: 'create',
                entity: 'user',
                name: newUser.name,
                email: newUser.email,
                role: newUser.role,
                details: `${req.user.name} created user: ${newUser.name} (${newUser.email}) with role: ${newUser.role}`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        console.log(`📝 User created: ${newUser.name} (${newUser.email}) by ${req.user.email} from IP: ${ip_address}`);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            user: newUser
        });

    } catch (err) {
        console.error('❌ Error creating user:', err);
        res.status(500).json({ message: 'Error creating user', error: err.message });
    }
};

// Update user (admin only) - NO PASSWORD (AD authenticated)
const updateUser = async (req, res) => {
    const { id } = req.params;
    const {
        email,
        name,
        role,
        department,
        branch,
        employee_id,
        pabx_extension,
        mobile_number
    } = req.body;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        // Get old user data before update
        const oldDataResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, email, name, role, department, branch, employee_id, pabx_extension, mobile_number FROM Users WHERE id = @id');

        if (oldDataResult.recordset.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        const oldUser = oldDataResult.recordset[0];
        const request = pool.request().input('id', sql.Int, id);
        const updates = [];
        const changes = {};

        // Check if email is being updated and validate it's not a duplicate
        if (email !== undefined && email !== oldUser.email) {
            const checkEmail = await pool.request()
                .input('email', sql.NVarChar, email)
                .input('id', sql.Int, id)
                .query('SELECT id FROM Users WHERE email = @email AND id != @id');

            if (checkEmail.recordset.length > 0) {
                return res.status(400).json({ message: 'Email already exists for another user' });
            }

            updates.push('email = @email');
            request.input('email', sql.NVarChar, email);
            changes.email = { old: oldUser.email, new: email };
        }

        if (name !== undefined && name !== oldUser.name) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
            changes.name = { old: oldUser.name, new: name };
        }

        if (role !== undefined && role !== oldUser.role) {
            updates.push('role = @role');
            request.input('role', sql.NVarChar, role);
            changes.role = { old: oldUser.role, new: role };
        }

        if (department !== undefined && department !== oldUser.department) {
            updates.push('department = @department');
            request.input('department', sql.NVarChar, department);
            changes.department = { old: oldUser.department || 'N/A', new: department || 'N/A' };
        }

        if (branch !== undefined && branch !== oldUser.branch) {
            updates.push('branch = @branch');
            request.input('branch', sql.NVarChar, branch);
            changes.branch = { old: oldUser.branch || 'N/A', new: branch || 'N/A' };
        }

        if (employee_id !== undefined && employee_id !== oldUser.employee_id) {
            if (employee_id) {
                const checkEmployee = await pool.request()
                    .input('employee_id', sql.NVarChar, employee_id)
                    .input('id', sql.Int, id)
                    .query('SELECT id FROM Users WHERE employee_id = @employee_id AND id != @id');

                if (checkEmployee.recordset.length > 0) {
                    return res.status(400).json({ message: 'Employee ID already exists for another user' });
                }
            }

            updates.push('employee_id = @employee_id');
            request.input('employee_id', sql.NVarChar, employee_id || null);
            changes.employee_id = { old: oldUser.employee_id || 'N/A', new: employee_id || 'N/A' };
        }

        if (pabx_extension !== undefined && pabx_extension !== oldUser.pabx_extension) {
            updates.push('pabx_extension = @pabx_extension');
            request.input('pabx_extension', sql.NVarChar, pabx_extension || null);
            changes.pabx_extension = {
                old: oldUser.pabx_extension || 'N/A',
                new: pabx_extension || 'N/A'
            };
        }

        if (mobile_number !== undefined && mobile_number !== oldUser.mobile_number) {
            updates.push('mobile_number = @mobile_number');
            request.input('mobile_number', sql.NVarChar, mobile_number || null);
            changes.mobile_number = {
                old: oldUser.mobile_number || 'N/A',
                new: mobile_number || 'N/A'
            };
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        await request.query(`UPDATE Users SET ${updates.join(', ')} WHERE id = @id`);

        // Fetch updated user data
        const updatedUserResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT 
                    id, 
                    email, 
                    name, 
                    role, 
                    department, 
                    branch, 
                    employee_id, 
                    pabx_extension, 
                    mobile_number, 
                    created_at 
                FROM Users 
                WHERE id = @id
            `);

        const newUser = updatedUserResult.recordset[0];

        // LOG: User update with audit
        await logAction(
            req,
            'UPDATE',
            'USER',
            id,
            oldUser,
            newUser,
            {
                changes: changes,
                details: `${req.user.name} updated user: ${newUser.name} (${newUser.email})`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        console.log(`📝 User updated: ${newUser.name} (${newUser.email}) by ${req.user.email} from IP: ${ip_address}`);

        res.json({
            success: true,
            message: 'User updated successfully',
            user: newUser
        });

    } catch (err) {
        console.error('❌ Error updating user:', err);
        res.status(500).json({ message: 'Error updating user', error: err.message });
    }
};

// Delete user (admin only)
const deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Users WHERE id = @id');
        res.json({ message: 'User deleted successfully' });
    } catch (err) {
        console.error('❌ Error deleting user:', err);
        res.status(500).json({ message: 'Error deleting user' });
    }
};

// Helper function to format duration
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0 seconds';
    if (seconds < 60) return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
}

// Get user activity statistics for dashboard - Using audit_logs table
const getUserActivityStats = async (req, res) => {
    try {
        const pool = await poolPromise;

        // Get online users (is_online = 1)
        const onlineResult = await pool.request()
            .query(`
                SELECT COUNT(*) as online_count 
                FROM Users 
                WHERE is_online = 1
            `);

        // Get active today (users who logged in today) from audit_logs
        const activeTodayResult = await pool.request()
            .query(`
                SELECT COUNT(DISTINCT user_id) as active_today
                FROM audit_logs
                WHERE action_type = 'LOGIN'
                AND CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)
            `);

        // Get total logins (sum of all login counts)
        const totalLoginsResult = await pool.request()
            .query(`
                SELECT ISNULL(SUM(login_count), 0) as total_logins
                FROM Users
            `);

        // Get total active hours (from total_active_seconds)
        const activeHoursResult = await pool.request()
            .query(`
                SELECT ISNULL(SUM(total_active_seconds), 0) as total_seconds
                FROM Users
            `);

        // Get top active users based on total_active_seconds and login_count
        const topActiveUsers = await pool.request()
            .query(`
                SELECT TOP 10
                    id, 
                    name, 
                    email, 
                    role,
                    ISNULL(total_active_seconds, 0) as total_active_seconds,
                    ISNULL(login_count, 0) as login_count,
                    CASE 
                        WHEN ISNULL(total_active_seconds, 0) > 0 
                        THEN CAST(ISNULL(total_active_seconds, 0) / 3600.0 AS DECIMAL(10,1))
                        ELSE 0 
                    END as active_hours,
                    last_login,
                    ISNULL(is_online, 0) as is_online
                FROM Users
                WHERE ISNULL(total_active_seconds, 0) > 0 OR ISNULL(login_count, 0) > 0
                ORDER BY total_active_seconds DESC, login_count DESC
            `);

        // Get recent logins from audit_logs
        const recentLogins = await pool.request()
            .query(`
                SELECT TOP 10
                    al.user_id,
                    al.user_name as name,
                    al.user_email as email,
                    al.created_at as login_time,
                    al.ip_address,
                    al.user_agent
                FROM audit_logs al
                WHERE al.action_type = 'LOGIN'
                ORDER BY al.created_at DESC
            `);

        // Get hourly activity for today from audit_logs
        const hourlyActivity = await pool.request()
            .query(`
                SELECT 
                    DATEPART(HOUR, created_at) as hour,
                    COUNT(*) as activity_count,
                    COUNT(DISTINCT user_id) as unique_users
                FROM audit_logs
                WHERE CAST(created_at AS DATE) = CAST(GETDATE() AS DATE)
                AND action_type IN ('LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'ASSIGN')
                GROUP BY DATEPART(HOUR, created_at)
                ORDER BY hour
            `);

        // Get user activity summary for each user (for the table view)
        const userActivitySummary = await pool.request()
            .query(`
                SELECT 
                    u.id,
                    u.employee_id,
                    u.email,
                    u.name,
                    u.role,
                    u.department,
                    u.branch,
                    u.last_login,
                    u.last_logout,
                    ISNULL(u.login_count, 0) as login_count,
                    ISNULL(u.is_online, 0) as is_online,
                    CASE 
                        WHEN ISNULL(u.total_active_seconds, 0) > 0 
                        THEN CAST(ISNULL(u.total_active_seconds, 0) / 3600.0 AS DECIMAL(10,1))
                        ELSE 0 
                    END as active_hours,
                    CASE 
                        WHEN ISNULL(u.is_online, 0) = 1 THEN 'Online'
                        WHEN u.last_login IS NOT NULL AND DATEDIFF(MINUTE, u.last_login, GETDATE()) < 5 THEN 'Active Recently'
                        WHEN u.last_login IS NULL THEN 'Never'
                        ELSE 'Offline'
                    END as status_text,
                    DATEDIFF(MINUTE, u.last_login, GETDATE()) as minutes_since_last_activity
                FROM Users u
                ORDER BY 
                    u.is_online DESC,
                    u.last_login DESC
            `);

        // Calculate session durations for recent logins
        const recentLoginsWithDuration = await Promise.all(
            recentLogins.recordset.map(async (login) => {
                // Find matching logout for this login
                const logoutResult = await pool.request()
                    .input('userId', sql.Int, login.user_id)
                    .input('loginTime', sql.DateTime, login.login_time)
                    .query(`
                        SELECT TOP 1
                            created_at as logout_time
                        FROM audit_logs
                        WHERE user_id = @userId
                        AND action_type = 'LOGOUT'
                        AND created_at > @loginTime
                        ORDER BY created_at ASC
                    `);

                let duration_formatted = 'Active session';

                if (logoutResult.recordset.length > 0) {
                    const loginTime = new Date(login.login_time);
                    const logoutTime = new Date(logoutResult.recordset[0].logout_time);
                    const seconds = Math.floor((logoutTime - loginTime) / 1000);
                    duration_formatted = formatDuration(seconds);
                }

                return {
                    ...login,
                    login_time_formatted: new Date(login.login_time).toLocaleString(),
                    minutes_ago: Math.floor((Date.now() - new Date(login.login_time)) / 60000),
                    duration: duration_formatted
                };
            })
        );

        res.json({
            success: true,
            data: {
                summary: {
                    online_users: onlineResult.recordset[0]?.online_count || 0,
                    active_today: activeTodayResult.recordset[0]?.active_today || 0,
                    total_logins: totalLoginsResult.recordset[0]?.total_logins || 0,
                    total_active_hours: Math.round((activeHoursResult.recordset[0]?.total_seconds || 0) / 3600)
                },
                top_active_users: topActiveUsers.recordset.map(user => ({
                    ...user,
                    active_hours_formatted: `${user.active_hours} hrs`,
                    last_login_formatted: user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'
                })),
                recent_logins: recentLoginsWithDuration,
                hourly_activity: hourlyActivity.recordset,
                user_activity_table: userActivitySummary.recordset
            }
        });

    } catch (err) {
        console.error('Error fetching user activity stats:', err);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

// Assignable users for the "Assign To" dropdown — returns id, email, name
const getAssignableUsers = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT id, email, name FROM Users ORDER BY name
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('❌ Error fetching assignable users:', err);
        res.status(500).json({ message: 'Error fetching assignable users' });
    }
};
// EXPORT ALL FUNCTIONS at the bottom (ONCE)
module.exports = {
    getAllUsers,
    getBasicUsers,
    getAssignableUsers,   // ← add

    createUser,
    updateUser,
    deleteUser,
    getUserActivityStats
};