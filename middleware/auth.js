const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
        return res.status(401).json({ message: 'Access denied. No token provided.' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        console.log('✅ Authenticated user:', { email: req.user.email, role: req.user.role });
        next();
    } catch (err) {
        console.error('❌ Invalid token:', err.message);
        return res.status(401).json({ message: 'Invalid or expired token.' });
    }
};

module.exports = authenticateToken;