// models/AuditLog.js
const { poolPromise, sql } = require('../config/db');

class AuditLog {
    // Get paginated audit logs
    static async getPaginated(filters = {}, pageSize = 20, offset = 0) {
        try {
            const pool = await poolPromise;
            
            // Build WHERE clause
            let whereClause = 'WHERE 1=1';
            const params = {};
            
            if (filters.action_type) {
                whereClause += ' AND action_type = @action_type';
                params.action_type = filters.action_type;
            }
            if (filters.entity_type) {
                whereClause += ' AND entity_type = @entity_type';
                params.entity_type = filters.entity_type;
            }
            if (filters.user_id) {
                whereClause += ' AND user_id = @user_id';
                params.user_id = parseInt(filters.user_id);
            }
            if (filters.start_date) {
                whereClause += ' AND CAST(created_at AS DATE) >= @start_date';
                params.start_date = filters.start_date;
            }
            if (filters.end_date) {
                whereClause += ' AND CAST(created_at AS DATE) <= @end_date';
                params.end_date = filters.end_date;
            }
            
            // Count query
            const countRequest = pool.request();
            Object.keys(params).forEach(key => {
                if (key === 'user_id') {
                    countRequest.input(key, sql.Int, params[key]);
                } else {
                    countRequest.input(key, sql.NVarChar, params[key]);
                }
            });
            
            const countResult = await countRequest.query(`
                SELECT COUNT(*) as total
                FROM audit_logs
                ${whereClause}
            `);
            
            const total = countResult.recordset[0].total;
            
            // Data query with pagination
            const dataRequest = pool.request();
            Object.keys(params).forEach(key => {
                if (key === 'user_id') {
                    dataRequest.input(key, sql.Int, params[key]);
                } else {
                    dataRequest.input(key, sql.NVarChar, params[key]);
                }
            });
            dataRequest.input('offset', sql.Int, offset);
            dataRequest.input('pageSize', sql.Int, pageSize);
            
            const result = await dataRequest.query(`
                SELECT 
                    id,
                    action_type,
                    entity_type,
                    entity_id,
                    old_value,
                    new_value,
                    changes,
                    user_id,
                    user_email,
                    user_name,
                    user_role,
                    ip_address,
                    user_agent,
                    created_at
                FROM audit_logs
                ${whereClause}
                ORDER BY created_at DESC
                OFFSET @offset ROWS
                FETCH NEXT @pageSize ROWS ONLY
            `);
            
            return {
                logs: result.recordset,
                total: total
            };
        } catch (error) {
            console.error('Error in getPaginated:', error);
            throw error;
        }
    }
    
    // Get all (with filters) - without pagination (for summary/stats)
    static async getAll(filters = {}) {
        try {
            const pool = await poolPromise;
            
            let whereClause = 'WHERE 1=1';
            const params = {};
            
            if (filters.action_type) {
                whereClause += ' AND action_type = @action_type';
                params.action_type = filters.action_type;
            }
            if (filters.entity_type) {
                whereClause += ' AND entity_type = @entity_type';
                params.entity_type = filters.entity_type;
            }
            if (filters.user_id) {
                whereClause += ' AND user_id = @user_id';
                params.user_id = parseInt(filters.user_id);
            }
            if (filters.start_date) {
                whereClause += ' AND CAST(created_at AS DATE) >= @start_date';
                params.start_date = filters.start_date;
            }
            if (filters.end_date) {
                whereClause += ' AND CAST(created_at AS DATE) <= @end_date';
                params.end_date = filters.end_date;
            }
            
            const request = pool.request();
            Object.keys(params).forEach(key => {
                if (key === 'user_id') {
                    request.input(key, sql.Int, params[key]);
                } else {
                    request.input(key, sql.NVarChar, params[key]);
                }
            });
            
            const result = await request.query(`
                SELECT 
                    id,
                    action_type,
                    entity_type,
                    entity_id,
                    old_value,
                    new_value,
                    changes,
                    user_id,
                    user_email,
                    user_name,
                    user_role,
                    ip_address,
                    user_agent,
                    created_at
                FROM audit_logs
                ${whereClause}
                ORDER BY created_at DESC
            `);
            
            return result.recordset;
        } catch (error) {
            console.error('Error in getAll:', error);
            throw error;
        }
    }
    
    // Get recent activities (limited)
    static async getRecentActivities(limit = 50) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('limit', sql.Int, limit)
                .query(`
                    SELECT TOP (@limit)
                        id,
                        action_type,
                        entity_type,
                        entity_id,
                        user_name,
                        user_email,
                        user_role,
                        ip_address,
                        created_at,
                        changes
                    FROM audit_logs
                    ORDER BY created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error in getRecentActivities:', error);
            throw error;
        }
    }
    
    // Get audit summary (for stats cards)
    static async getSummary() {
        try {
            const pool = await poolPromise;
            
            const result = await pool.request().query(`
                SELECT 
                    COUNT(*) as total_actions,
                    SUM(CASE WHEN action_type = 'CREATE' THEN 1 ELSE 0 END) as total_creates,
                    SUM(CASE WHEN action_type = 'UPDATE' THEN 1 ELSE 0 END) as total_updates,
                    SUM(CASE WHEN action_type = 'DELETE' THEN 1 ELSE 0 END) as total_deletes,
                    SUM(CASE WHEN action_type = 'ASSIGN' THEN 1 ELSE 0 END) as total_assigns,
                    COUNT(DISTINCT user_id) as active_users
                FROM audit_logs
                WHERE created_at >= DATEADD(day, -30, GETDATE())
            `);
            
            return result.recordset[0];
        } catch (error) {
            console.error('Error in getSummary:', error);
            throw error;
        }
    }
    
    // Get logs by entity with pagination
    static async getByEntityPaginated(entityType, entityId, pageSize = 20, offset = 0) {
        try {
            const pool = await poolPromise;
            
            // Count query
            const countResult = await pool.request()
                .input('entity_type', sql.NVarChar, entityType)
                .input('entity_id', sql.NVarChar, entityId)
                .query(`
                    SELECT COUNT(*) as total
                    FROM audit_logs
                    WHERE entity_type = @entity_type AND entity_id = @entity_id
                `);
            
            const total = countResult.recordset[0].total;
            
            // Data query with pagination
            const result = await pool.request()
                .input('entity_type', sql.NVarChar, entityType)
                .input('entity_id', sql.NVarChar, entityId)
                .input('offset', sql.Int, offset)
                .input('pageSize', sql.Int, pageSize)
                .query(`
                    SELECT 
                        id,
                        action_type,
                        entity_type,
                        entity_id,
                        old_value,
                        new_value,
                        changes,
                        user_id,
                        user_email,
                        user_name,
                        user_role,
                        ip_address,
                        user_agent,
                        created_at
                    FROM audit_logs
                    WHERE entity_type = @entity_type AND entity_id = @entity_id
                    ORDER BY created_at DESC
                    OFFSET @offset ROWS
                    FETCH NEXT @pageSize ROWS ONLY
                `);
            
            return {
                logs: result.recordset,
                total: total
            };
        } catch (error) {
            console.error('Error in getByEntityPaginated:', error);
            throw error;
        }
    }
    
    // Get logs by entity (without pagination)
    static async getByEntity(entityType, entityId) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('entity_type', sql.NVarChar, entityType)
                .input('entity_id', sql.NVarChar, entityId)
                .query(`
                    SELECT 
                        id,
                        action_type,
                        entity_type,
                        entity_id,
                        old_value,
                        new_value,
                        changes,
                        user_id,
                        user_email,
                        user_name,
                        user_role,
                        ip_address,
                        user_agent,
                        created_at
                    FROM audit_logs
                    WHERE entity_type = @entity_type AND entity_id = @entity_id
                    ORDER BY created_at DESC
                `);
            return result.recordset;
        } catch (error) {
            console.error('Error in getByEntity:', error);
            throw error;
        }
    }
    
    // Create audit log entry
    static async create(data) {
        try {
            const pool = await poolPromise;
            const result = await pool.request()
                .input('action_type', sql.NVarChar, data.action_type)
                .input('entity_type', sql.NVarChar, data.entity_type)
                .input('entity_id', sql.NVarChar, data.entity_id)
                .input('old_value', sql.NVarChar, data.old_value)
                .input('new_value', sql.NVarChar, data.new_value)
                .input('changes', sql.NVarChar, data.changes)
                .input('user_id', sql.Int, data.user_id)
                .input('user_email', sql.NVarChar, data.user_email)
                .input('user_name', sql.NVarChar, data.user_name)
                .input('user_role', sql.NVarChar, data.user_role)
                .input('ip_address', sql.NVarChar, data.ip_address)
                .input('user_agent', sql.NVarChar, data.user_agent)
                .query(`
                    INSERT INTO audit_logs (
                        action_type, entity_type, entity_id, old_value, new_value,
                        changes, user_id, user_email, user_name, user_role,
                        ip_address, user_agent, created_at
                    )
                    VALUES (
                        @action_type, @entity_type, @entity_id, @old_value, @new_value,
                        @changes, @user_id, @user_email, @user_name, @user_role,
                        @ip_address, @user_agent, GETDATE()
                    )
                `);
            return result;
        } catch (error) {
            console.error('Error in create:', error);
            throw error;
        }
    }
}

module.exports = AuditLog;