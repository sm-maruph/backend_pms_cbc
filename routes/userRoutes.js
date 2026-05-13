const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { 
    getAllUsers,      
    getBasicUsers,    
    createUser, 
    updateUser, 
    deleteUser 
} = require('../controllers/userController');

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

// ✅ ALL authenticated users - limited data (only what's needed for assignment)
router.get('/assignable', auth, getBasicUsers);

// ✅ Admin only - full user data with sensitive info
router.get('/', auth, isAdmin, getAllUsers);

// ✅ Admin only - write operations
router.post('/', auth, isAdmin, createUser);
router.put('/:id', auth, isAdmin, updateUser);
router.delete('/:id', auth, isAdmin, deleteUser);

module.exports = router;