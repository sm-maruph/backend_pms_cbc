const { poolPromise, sql } = require('../config/db');

// Helper function to get user ID from email
const getUserIdByEmail = async (email) => {
    if (!email) return null;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('email', sql.NVarChar, email)
            .query('SELECT id FROM Users WHERE email = @email');
        return result.recordset[0]?.id || null;
    } catch (err) {
        console.error('Error getting user ID:', err);
        return null;
    }
};

// Get user's notifications (UPDATED to use user_id)
exports.getUserNotifications = async (req, res) => {
    const userEmail = req.user.email;
    const { limit = 50, offset = 0 } = req.query;
    
    try {
        const pool = await poolPromise;
        
        // Get user ID from email
        const userId = await getUserIdByEmail(userEmail);
        if (!userId) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const result = await pool.request()
            .input('user_id', sql.Int, userId)
            .input('limit', sql.Int, parseInt(limit))
            .input('offset', sql.Int, parseInt(offset))
            .query(`
                SELECT id, type, title, message, ticket_sl, is_read, 
                       CONVERT(NVARCHAR(50), created_at, 127) as created_at, metadata
                FROM Notifications
                WHERE user_id = @user_id
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

// Get unread count (UPDATED to use user_id)
exports.getUnreadCount = async (req, res) => {
    const userEmail = req.user.email;
    
    try {
        const pool = await poolPromise;
        
        // Get user ID from email
        const userId = await getUserIdByEmail(userEmail);
        if (!userId) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        const result = await pool.request()
            .input('user_id', sql.Int, userId)
            .query('SELECT COUNT(*) as count FROM Notifications WHERE user_id = @user_id AND is_read = 0');
        
        res.json({ count: result.recordset[0].count });
    } catch (err) {
        console.error('Error fetching unread count:', err);
        res.status(500).json({ message: 'Error fetching unread count', error: err.message });
    }
};

// Mark notification as read (UPDATED to use user_id)
exports.markAsRead = async (req, res) => {
    const { id } = req.params;
    const userEmail = req.user.email;

    try {
        const pool = await poolPromise;
        
        // Get user ID from email
        const userId = await getUserIdByEmail(userEmail);
        if (!userId) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        await pool.request()
            .input('id', sql.Int, id)
            .input('user_id', sql.Int, userId)
            .query('UPDATE Notifications SET is_read = 1 WHERE id = @id AND user_id = @user_id');
        
        res.json({ message: 'Notification marked as read' });
    } catch (err) {
        console.error('Error marking notification as read:', err);
        res.status(500).json({ message: 'Error marking notification as read' });
    }
};

// Mark all notifications as read (UPDATED to use user_id)
exports.markAllAsRead = async (req, res) => {
    const userEmail = req.user.email;

    try {
        const pool = await poolPromise;
        
        // Get user ID from email
        const userId = await getUserIdByEmail(userEmail);
        if (!userId) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        await pool.request()
            .input('user_id', sql.Int, userId)
            .query('UPDATE Notifications SET is_read = 1 WHERE user_id = @user_id AND is_read = 0');
        
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        console.error('Error marking all as read:', err);
        res.status(500).json({ message: 'Error marking all as read' });
    }
};

// Helper function to save notification (UPDATED to use user_id)
const saveNotification = async (userEmail, notification, ticket_sl = null, metadata = null) => {
    try {
        const pool = await poolPromise;
        
        // Get user ID from email
        const userId = await getUserIdByEmail(userEmail);
        if (!userId) {
            console.error('User not found:', userEmail);
            return false;
        }
        
        await pool.request()
            .input('user_id', sql.Int, userId)
            .input('type', sql.NVarChar, notification.type)
            .input('title', sql.NVarChar, notification.title)
            .input('message', sql.NVarChar, notification.message)
            .input('ticket_sl', sql.NVarChar, ticket_sl)
            .input('metadata', sql.NVarChar, metadata ? JSON.stringify(metadata) : null)
            .query(`
                INSERT INTO Notifications (user_id, type, title, message, ticket_sl, metadata, created_at)
                VALUES (@user_id, @type, @title, @message, @ticket_sl, @metadata, GETUTCDATE())
            `);
        return true;
    } catch (err) {
        console.error('Failed to save notification:', err);
        return false;
    }
};

// Export the saveNotification function for use in other controllers
module.exports.saveNotification = saveNotification;