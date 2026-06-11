const AuditLog = require('../models/AuditLog');

const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           req.ip || 
           'unknown';
};

const logAction = async (req, actionType, entityType, entityId, oldValue = null, newValue = null, changes = null, userInfo = null) => {
    try {
        // Determine user info
        let userId = null;
        let userEmail = null;
        let userName = null;
        let userRole = null;
        
        if (userInfo) {
            userId = userInfo.id || null;
            userEmail = userInfo.email || null;
            userName = userInfo.name || null;
            userRole = userInfo.role || null;
        } else if (req.user) {
            userId = req.user.id || null;
            userEmail = req.user.email || null;
            userName = req.user.name || null;
            userRole = req.user.role || null;
        }
        
        // For failed logins, try to get email from newValue
        if (!userEmail && newValue?.email) {
            userEmail = newValue.email;
        }
        if (!userName && newValue?.name) {
            userName = newValue.name;
        }
        
        const ip_address = getClientIp(req);
        const user_agent = req.headers['user-agent'] || null;
        
        console.log(`📝 Audit Log - Action: ${actionType}, User: ${userEmail || 'unknown'}, IP: ${ip_address}`);
        
        const result = await AuditLog.create({
            action_type: actionType,
            entity_type: entityType,
            entity_id: String(entityId),
            old_value: oldValue ? JSON.stringify(oldValue) : null,
            new_value: newValue ? JSON.stringify(newValue) : null,
            changes: changes ? JSON.stringify(changes) : null,
            user_id: userId,
            user_email: userEmail,
            user_name: userName,
            user_role: userRole,
            ip_address: ip_address,
            user_agent: user_agent
        });
        
        console.log(`✅ Audit logged: ${actionType} on ${entityType} #${entityId}`);
        return result;
        
    } catch (error) {
        console.error('❌ Failed to log audit:', error.message);
        return null;
    }
};

module.exports = { logAction, getClientIp };