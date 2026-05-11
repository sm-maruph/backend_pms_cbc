const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAllUsers, createUser, updateUser, deleteUser } = require('../controllers/userController');

const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
    next();
};
router.use(auth, isAdmin);
router.get('/', getAllUsers);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
module.exports = router;
