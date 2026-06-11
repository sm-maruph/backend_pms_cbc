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
exports.getBasicUsers = async (req, res) => {
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
exports.getAllUsers = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT id, email, name, role, department, branch, created_at, 
                employee_id, 
                is_online, 
                last_login,
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

// Create user (admin only)
// Create user with audit log (NO PASSWORD - AD authenticated)
exports.createUser = async (req, res) => {
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

        // ✅ LOG: User creation
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

// Update user (admin only)
// Update user (admin only) - NO PASSWORD (AD authenticated)
exports.updateUser = async (req, res) => {
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
            // Check if employee_id already exists for another user
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

        // PABX Extension
        if (pabx_extension !== undefined && pabx_extension !== oldUser.pabx_extension) {
            updates.push('pabx_extension = @pabx_extension');
            request.input('pabx_extension', sql.NVarChar, pabx_extension || null);
            changes.pabx_extension = {
                old: oldUser.pabx_extension || 'N/A',
                new: pabx_extension || 'N/A'
            };
        }

        // Mobile Number
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

        // ✅ LOG: User update with audit
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
exports.deleteUser = async (req, res) => {
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

// Get user activity statistics (for admin dashboard)
exports.getUserActivityStats = async (req, res) => {
    try {
        const pool = await poolPromise;

        // Get overall statistics
        const statsResult = await pool.request()
            .query(`
                SELECT 
                    COUNT(*) as total_users,
                    SUM(CASE WHEN is_online = 1 THEN 1 ELSE 0 END) as online_users,
                    SUM(CASE WHEN is_online = 0 AND last_login IS NOT NULL THEN 1 ELSE 0 END) as active_today,
                    SUM(login_count) as total_logins,
                    SUM(total_active_seconds) as total_active_seconds,
                    AVG(total_active_seconds) as avg_active_seconds
                FROM Users
                WHERE last_login >= DATEADD(DAY, -30, GETDATE())
            `);

        // Get top active users
        const topUsersResult = await pool.request()
            .query(`
                SELECT TOP 10
                    id,
                    name,
                    email,
                    role,
                    login_count,
                    total_active_seconds,
                    last_login,
                    CASE 
                        WHEN total_active_seconds < 3600 THEN CAST(total_active_seconds / 60 AS VARCHAR) + ' minutes'
                        ELSE CAST(total_active_seconds / 3600 AS VARCHAR) + ' hours ' + 
                             CAST((total_active_seconds % 3600) / 60 AS VARCHAR) + ' minutes'
                    END as active_time_formatted
                FROM Users
                WHERE total_active_seconds > 0
                ORDER BY total_active_seconds DESC
            `);

        // Get daily login trends (last 7 days)
        const dailyTrends = await pool.request()
            .query(`
                SELECT 
                    CAST(created_at AS DATE) as date,
                    COUNT(*) as login_count
                FROM audit_logs
                WHERE action_type = 'LOGIN'
                    AND created_at >= DATEADD(DAY, -7, GETDATE())
                GROUP BY CAST(created_at AS DATE)
                ORDER BY date DESC
            `);

        const stats = statsResult.recordset[0];

        res.json({
            success: true,
            data: {
                summary: {
                    total_users: stats.total_users || 0,
                    online_users: stats.online_users || 0,
                    active_today: stats.active_today || 0,
                    total_logins: stats.total_logins || 0,
                    total_active_hours: Math.round((stats.total_active_seconds || 0) / 3600),
                    avg_active_minutes: Math.round((stats.avg_active_seconds || 0) / 60)
                },
                top_active_users: topUsersResult.recordset,
                daily_login_trends: dailyTrends.recordset
            }
        });

    } catch (error) {
        console.error('Error getting user activity stats:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};