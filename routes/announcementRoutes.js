const express = require('express');
const router = express.Router();
const {
    getAnnouncements,
    getActiveAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    toggleAnnouncementStatus,
} = require('../controllers/announcementController');
const authenticateToken = require('../middleware/auth');

// Admin check — match the actual role names from the roles table
const isAdmin = (req, res, next) => {
    const role = req.user?.role;
    if (role === 'Admin' || role === 'Super Admin') {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: 'Access denied. Admin rights required.',
        your_role: role,
    });
};

// User routes (any authenticated user can view active announcements)
router.get('/active', authenticateToken, getActiveAnnouncements);

// Admin only routes
router.get('/', authenticateToken, isAdmin, getAnnouncements);
router.get('/:id', authenticateToken, isAdmin, getAnnouncementById);
router.post('/', authenticateToken, isAdmin, createAnnouncement);
router.put('/:id', authenticateToken, isAdmin, updateAnnouncement);
router.delete('/:id', authenticateToken, isAdmin, deleteAnnouncement);
router.patch('/:id/toggle', authenticateToken, isAdmin, toggleAnnouncementStatus);

module.exports = router;