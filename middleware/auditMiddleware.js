const AuditLog = require('../models/AuditLog');

// Get client IP address
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           req.ip;
};

// Audit log middleware
const audit = (actionType, entityType, getEntityId, getOldValue, getNewValue, getChanges) => {
    return async (req, res, next) => {
        // Store original send function
        const originalSend = res.send;
        const originalJson = res.json;
        
        // Override json method to capture response
        res.json = function(data) {
            res.json = originalJson;
            res.send = originalSend;
            
            // Only log after successful operation
            if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
                const entityId = getEntityId ? getEntityId(req, data) : req.params.id || req.body.id;
                const oldValue = getOldValue ? getOldValue(req) : null;
                const newValue = getNewValue ? getNewValue(req, data) : null;
                const changes = getChanges ? getChanges(req, data) : null;
                
                // Create audit log asynchronously (don't wait for response)
                AuditLog.create({
                    action_type: actionType,
                    entity_type: entityType,
                    entity_id: entityId,
                    old_value: oldValue ? JSON.stringify(oldValue) : null,
                    new_value: newValue ? JSON.stringify(newValue) : null,
                    changes: changes ? JSON.stringify(changes) : null,
                    user_id: req.user.id,
                    user_email: req.user.email,
                    user_name: req.user.name,
                    user_role: req.user.role,
                    ip_address: getClientIp(req),
                    user_agent: req.headers['user-agent']
                }).catch(err => console.error('Audit log error:', err));
            }
            
            return originalJson.call(this, data);
        };
        
        next();
    };
};

// Helper function to track object changes
const getChangesBetweenObjects = (oldObj, newObj) => {
    const changes = {};
    if (!oldObj || !newObj) return changes;
    
    Object.keys(newObj).forEach(key => {
        if (oldObj[key] !== newObj[key]) {
            changes[key] = {
                old: oldObj[key],
                new: newObj[key]
            };
        }
    });
    
    return changes;
};

module.exports = { audit, getChangesBetweenObjects, getClientIp };