const { poolPromise, sql } = require('../config/db');

// Get user's notifications
// Get user's notifications
exports.getUserNotifications = async (req, res) => {
    const userEmail = req.user.email;
    const { limit = 50, offset = 0 } = req.query;
    
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('user_email', sql.NVarChar, userEmail)
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, parseInt(offset))
            .query(`
                SELECT id, type, title, message, ticket_sl, is_read, 
                       CONVERT(NVARCHAR(50), created_at, 127) as created_at, metadata
                FROM Notifications
                WHERE user_email = @user_email
                ORDER BY created_at DESC
                OFFSET @offset ROWS
                FETCH NEXT @limit ROWS ONLY
            `);
        
        // Format dates as ISO UTC
        const formattedResults = result.recordset.map(record => ({
            ...record,
            created_at: record.created_at ? new Date(record.created_at).toISOString() : null
        }));
        
        res.json(formattedResults);
    } catch (err) {
        console.error('Error fetching notifications:', err);
        res.status(500).json({ message: 'Error fetching notifications', error: err.message });
    }
};
// Get unread count
exports.getUnreadCount = async (req, res) => {
    const userEmail = req.user.email;
    
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('user_email', sql.NVarChar, userEmail)
            .query('SELECT COUNT(*) as count FROM Notifications WHERE user_email = @user_email AND is_read = 0');
        res.json({ count: result.recordset[0].count });
    } catch (err) {
        console.error('Error fetching unread count:', err);
        res.status(500).json({ message: 'Error fetching unread count', error: err.message });
    }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
    const { id } = req.params;
    const userEmail = req.user.email;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .input('user_email', sql.NVarChar, userEmail)
            .query('UPDATE Notifications SET is_read = 1 WHERE id = @id AND user_email = @user_email');
        res.json({ message: 'Notification marked as read' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error marking notification as read' });
    }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
    const userEmail = req.user.email;

    try {
        const pool = await poolPromise;
        await pool.request()
            .input('user_email', sql.NVarChar, userEmail)
            .query('UPDATE Notifications SET is_read = 1 WHERE user_email = @user_email AND is_read = 0');
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error marking all as read' });
    }
};

// Helper function to save notification (export for use in other controllers)
const saveNotification = async (userEmail, notification, ticket_sl = null, metadata = null) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('user_email', sql.NVarChar, userEmail)
            .input('type', sql.NVarChar, notification.type)
            .input('title', sql.NVarChar, notification.title)
            .input('message', sql.NVarChar, notification.message)
            .input('ticket_sl', sql.NVarChar, ticket_sl)
            .input('metadata', sql.NVarChar, metadata ? JSON.stringify(metadata) : null)
            .query(`
                INSERT INTO Notifications (user_email, type, title, message, ticket_sl, metadata, created_at)
                VALUES (@user_email, @type, @title, @message, @ticket_sl, @metadata, GETUTCDATE())
            `);
        return true;
    } catch (err) {
        console.error('Failed to save notification:', err);
        return false;
    }
};