const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/auth');
const { requirePermission } = require('../middleware/permissions');

// Get all audit logs with pagination
router.get('/', authenticateToken, requirePermission('audit.view'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        const offset = (page - 1) * pageSize;
        const filters = {
            action_type: req.query.action_type,
            entity_type: req.query.entity_type,
            user_id: req.query.user_id,
            start_date: req.query.start_date,
            end_date: req.query.end_date
        };
        const { logs, total } = await AuditLog.getPaginated(filters, pageSize, offset);
        res.json({
            success: true,
            data: logs,
            pagination: {
                currentPage: page, pageSize, totalCount: total,
                totalPages: Math.ceil(total / pageSize),
                hasNext: page < Math.ceil(total / pageSize),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Recent activities (dashboard widget)
router.get('/recent', authenticateToken, requirePermission('audit.view'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const logs = await AuditLog.getRecentActivities(limit);
        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Error fetching recent activities:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Audit summary (stats cards)
router.get('/summary', authenticateToken, requirePermission('audit.view'), async (req, res) => {
    try {
        const summary = await AuditLog.getSummary();
        res.json({ success: true, data: summary });
    } catch (error) {
        console.error('Error fetching audit summary:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Audit logs for a specific entity
router.get('/entity/:type/:id', authenticateToken, requirePermission('audit.view'), async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 20;
        const offset = (page - 1) * pageSize;
        const { logs, total } = await AuditLog.getByEntityPaginated(
            req.params.type, req.params.id, pageSize, offset
        );
        res.json({
            success: true,
            data: logs,
            pagination: {
                currentPage: page, pageSize, totalCount: total,
                totalPages: Math.ceil(total / pageSize),
                hasNext: page < Math.ceil(total / pageSize),
                hasPrev: page > 1
            }
        });
    } catch (error) {
        console.error('Error fetching entity audit logs:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// User activity statistics
router.get('/user-activity', authenticateToken, requirePermission('activity.view'), async (req, res) => {
    try {
        const pool = await require('../config/db').poolPromise;  // awaited poolPromise, not .pool

        const onlineUsersResult = await pool.request()
            .query(`SELECT COUNT(*) as count FROM users WHERE is_online = 1`);
        const activeTodayResult = await pool.request()
            .query(`SELECT COUNT(DISTINCT user_id) as count FROM UserSessions
                    WHERE CAST(login_at AS DATE) = CAST(GETDATE() AS DATE)`);
        const totalLoginsResult = await pool.request()
            .query(`SELECT COUNT(*) as count FROM UserSessions`);
        const totalHoursResult = await pool.request()
            .query(`SELECT SUM(session_duration_seconds) as total_seconds FROM UserSessions WHERE logout_at IS NOT NULL`);
        const totalActiveHours = totalHoursResult.recordset[0]?.total_seconds
            ? Math.floor(totalHoursResult.recordset[0].total_seconds / 3600) : 0;

        const topActiveUsers = await pool.request().query(`
            SELECT TOP 10 u.id, u.name, u.email, u.role,
                SUM(us.session_duration_seconds) as total_seconds,
                COUNT(us.id) as login_count, MAX(us.login_at) as last_login, u.is_online
            FROM users u LEFT JOIN UserSessions us ON u.id = us.user_id
            GROUP BY u.id, u.name, u.email, u.role, u.is_online
            ORDER BY total_seconds DESC`);

        const recentLogins = await pool.request().query(`
            SELECT TOP 10 u.id, u.name, u.email, us.login_at, us.logout_at, us.ip_address,
                DATEDIFF(MINUTE, us.login_at, ISNULL(us.logout_at, GETDATE())) as minutes_ago
            FROM UserSessions us INNER JOIN users u ON us.user_id = u.id
            ORDER BY us.login_at DESC`);

        const hourlyActivity = await pool.request().query(`
            SELECT DATEPART(HOUR, login_at) as hour, COUNT(*) as activity_count,
                COUNT(DISTINCT user_id) as unique_users
            FROM UserSessions WHERE login_at >= DATEADD(DAY, -7, GETDATE())
            GROUP BY DATEPART(HOUR, login_at) ORDER BY hour`);

        res.json({
            success: true,
            data: {
                summary: {
                    online_users: onlineUsersResult.recordset[0]?.count || 0,
                    active_today: activeTodayResult.recordset[0]?.count || 0,
                    total_logins: totalLoginsResult.recordset[0]?.count || 0,
                    total_active_hours: totalActiveHours
                },
                top_active_users: topActiveUsers.recordset.map(u => ({
                    id: u.id, name: u.name, email: u.email, role: u.role,
                    active_hours: Math.floor((u.total_seconds || 0) / 3600),
                    login_count: u.login_count, last_login: u.last_login,
                    is_online: u.is_online === 1
                })),
                recent_logins: recentLogins.recordset.map(l => ({
                    name: l.name, email: l.email, login_time: l.login_at,
                    duration: l.logout_at ? `${l.minutes_ago} minutes` : 'Active session',
                    minutes_ago: l.minutes_ago, ip_address: l.ip_address
                })),
                hourly_activity: hourlyActivity.recordset.map(h => ({
                    hour: h.hour, activity_count: h.activity_count, unique_users: h.unique_users
                })),
                user_activity_table: topActiveUsers.recordset.map(u => ({
                    id: u.id, name: u.name, email: u.email, role: u.role,
                    active_hours: Math.floor((u.total_seconds || 0) / 3600),
                    login_count: u.login_count, last_login: u.last_login,
                    is_online: u.is_online === 1,
                    status_text: u.is_online === 1 ? 'Online' : (u.last_login ? 'Active Recently' : 'Inactive'),
                    minutes_since_last_activity: u.last_login ? Math.floor((Date.now() - new Date(u.last_login)) / 60000) : null
                }))
            }
        });
    } catch (error) {
        console.error('Error fetching user activity:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;