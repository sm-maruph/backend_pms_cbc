const sql = require('mssql');
const { poolPromise } = require('../config/db');

class Announcement {
    // Get all announcements
    static async getAll() {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .query(`
                    SELECT 
                        id, 
                        title, 
                        content, 
                        priority, 
                        is_active, 
                        expires_at,
                        created_by,
                        created_by_name,
                        created_at,
                        updated_at
                    FROM announcements 
                    ORDER BY created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error in getAll:', error);
            throw error;
        }
    }

    // Get active announcements (for users)
    static async getActive() {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .query(`
                    SELECT TOP 10
                        id, 
                        title, 
                        content, 
                        priority, 
                        is_active, 
                        expires_at,
                        created_by_name,
                        created_at
                    FROM announcements 
                    WHERE is_active = 1 
                        AND (expires_at IS NULL OR expires_at > GETDATE())
                    ORDER BY 
                        CASE priority 
                            WHEN 'urgent' THEN 1
                            WHEN 'high' THEN 2
                            WHEN 'normal' THEN 3
                            WHEN 'low' THEN 4
                        END,
                        created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error in getActive:', error);
            throw error;
        }
    }

    // Get single announcement by ID
    static async getById(id) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, id)
                .query(`
                    SELECT 
                        id, 
                        title, 
                        content, 
                        priority, 
                        is_active, 
                        expires_at,
                        created_by,
                        created_by_name,
                        created_at,
                        updated_at
                    FROM announcements 
                    WHERE id = @id
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error in getById:', error);
            throw error;
        }
    }

    // Create announcement
    static async create(data) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('title', sql.NVarChar, data.title)
                .input('content', sql.NVarChar, data.content)
                .input('priority', sql.NVarChar, data.priority || 'normal')
                .input('is_active', sql.Bit, data.is_active !== undefined ? data.is_active : true)
                .input('expires_at', sql.DateTime, data.expires_at || null)
                .input('created_by', sql.Int, data.created_by)
                .input('created_by_name', sql.NVarChar, data.created_by_name)
                .query(`
                    INSERT INTO announcements (title, content, priority, is_active, expires_at, created_by, created_by_name)
                    OUTPUT INSERTED.*
                    VALUES (@title, @content, @priority, @is_active, @expires_at, @created_by, @created_by_name)
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error in create:', error);
            throw error;
        }
    }

    // Update announcement
    static async update(id, data) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, id)
                .input('title', sql.NVarChar, data.title)
                .input('content', sql.NVarChar, data.content)
                .input('priority', sql.NVarChar, data.priority)
                .input('is_active', sql.Bit, data.is_active)
                .input('expires_at', sql.DateTime, data.expires_at || null)
                .query(`
                    UPDATE announcements 
                    SET 
                        title = @title,
                        content = @content,
                        priority = @priority,
                        is_active = @is_active,
                        expires_at = @expires_at
                    WHERE id = @id
                    
                    SELECT * FROM announcements WHERE id = @id
                `);
            return result.recordset[0];
        } catch (error) {
            console.error('Error in update:', error);
            throw error;
        }
    }

    // Delete announcement
    static async delete(id) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, id)
                .query(`DELETE FROM announcements WHERE id = @id`);
            return result.rowsAffected[0] > 0;
        } catch (error) {
            console.error('Error in delete:', error);
            throw error;
        }
    }

    // Toggle announcement status
    static async toggleStatus(id) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('id', sql.Int, id)
                .query(`
                    UPDATE announcements 
                    SET is_active = ~is_active
                    OUTPUT INSERTED.is_active as new_status
                    WHERE id = @id
                `);
            return result.recordset[0]?.new_status === 1;
        } catch (error) {
            console.error('Error in toggleStatus:', error);
            throw error;
        }
    }

    // Get count of active announcements
    static async getActiveCount() {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .query(`
                    SELECT COUNT(*) as count 
                    FROM announcements 
                    WHERE is_active = 1 
                        AND (expires_at IS NULL OR expires_at > GETDATE())
                `);
            return result.recordset[0].count;
        } catch (error) {
            console.error('Error in getActiveCount:', error);
            throw error;
        }
    }
}

module.exports = Announcement;