const sql = require('mssql');
const { poolPromise } = require('../config/db');

class AuditLog {
    static async create(data) {
        try {
            const pool = await poolPromise;

            const result = await pool.request()
                .input('action_type', sql.NVarChar, data.action_type)
                .input('entity_type', sql.NVarChar, data.entity_type)
                .input('entity_id', sql.NVarChar, data.entity_id)
                .input('old_value', sql.NVarChar, data.old_value || null)
                .input('new_value', sql.NVarChar, data.new_value || null)
                .input('changes', sql.NVarChar, data.changes || null)
                .input('user_id', sql.Int, data.user_id || null)
                .input('user_email', sql.NVarChar, data.user_email || null)
                .input('user_name', sql.NVarChar, data.user_name || null)
                .input('user_role', sql.NVarChar, data.user_role || null)
                .input('ip_address', sql.NVarChar, data.ip_address || null)
                .input('user_agent', sql.NVarChar, data.user_agent || null)
                .query(`
        INSERT INTO audit_logs (
            action_type, entity_type, entity_id, old_value, new_value, changes,
            user_id, user_email, user_name, user_role, ip_address, user_agent, created_at
        ) VALUES (
            @action_type, @entity_type, @entity_id, @old_value, @new_value, @changes,
            @user_id, @user_email, @user_name, @user_role, @ip_address, @user_agent, 
            GETUTCDATE()  
        )
    `);

            return result;
        } catch (error) {
            console.error('❌ Error creating audit log:', error.message);
            throw error;
        }
    }

    static async getAll(filters = {}) {
        try {
            const pool = await poolPromise;
            let query = `SELECT * FROM audit_logs WHERE 1=1`;
            const request = pool.request();

            if (filters.action_type) {
                query += ` AND action_type = @action_type`;
                request.input('action_type', sql.NVarChar, filters.action_type);
            }
            if (filters.entity_type) {
                query += ` AND entity_type = @entity_type`;
                request.input('entity_type', sql.NVarChar, filters.entity_type);
            }
            if (filters.start_date) {
                query += ` AND CAST(created_at AS DATE) >= @start_date`;
                request.input('start_date', sql.Date, filters.start_date);
            }
            if (filters.end_date) {
                query += ` AND CAST(created_at AS DATE) <= @end_date`;
                request.input('end_date', sql.Date, filters.end_date);
            }
            query += ` ORDER BY created_at DESC`;

            const result = await request.query(query);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching audit logs:', error);
            return [];
        }
    }

    static async getRecentActivities(limit = 50) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .query(`SELECT TOP ${limit} * FROM audit_logs ORDER BY created_at DESC`);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching recent activities:', error);
            return [];
        }
    }

    static async getByEntity(entityType, entityId) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('entity_type', sql.NVarChar, entityType)
                .input('entity_id', sql.NVarChar, entityId)
                .query(`
                    SELECT * FROM audit_logs 
                    WHERE entity_type = @entity_type AND entity_id = @entity_id
                    ORDER BY created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error fetching entity audit logs:', error);
            return [];
        }
    }

    static async getSummary() {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .query(`
                    SELECT 
                        COUNT(*) as total_actions,
                        COUNT(DISTINCT user_id) as active_users,
                        COUNT(CASE WHEN action_type = 'CREATE' THEN 1 END) as total_creates,
                        COUNT(CASE WHEN action_type = 'UPDATE' THEN 1 END) as total_updates,
                        COUNT(CASE WHEN action_type = 'DELETE' THEN 1 END) as total_deletes,
                        COUNT(CASE WHEN action_type = 'ASSIGN' THEN 1 END) as total_assigns,
                        COUNT(CASE WHEN action_type = 'LOGIN' THEN 1 END) as total_logins,
                        COUNT(CASE WHEN action_type = 'LOGIN_FAILED' THEN 1 END) as total_failed_logins
                    FROM audit_logs
                    WHERE created_at >= DATEADD(DAY, -30, GETDATE())
                `);
            return result.recordset[0] || {
                total_actions: 0,
                active_users: 0,
                total_creates: 0,
                total_updates: 0,
                total_deletes: 0,
                total_assigns: 0,
                total_logins: 0,
                total_failed_logins: 0
            };
        } catch (error) {
            console.error('Error fetching audit summary:', error);
            return null;
        }
    }
}

module.exports = AuditLog;