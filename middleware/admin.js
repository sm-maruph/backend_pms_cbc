// middleware/admin.js
const admin = (req, res, next) => {
    const adminRoles = ['Super Admin', 'Admin', 'super admin', 'admin'];
    
    if (!req.user) {
        return res.status(401).json({ message: 'Authentication required.' });
    }
    
    if (adminRoles.includes(req.user.role)) {
        next();
    } else {
        console.log(`❌ Admin access denied for user: ${req.user.email} with role: ${req.user.role}`);
        res.status(403).json({ 
            message: 'Admin access required. Only Super Admin and Admin can access this resource.',
            your_role: req.user.role 
        });
    }
};

module.exports = admin;