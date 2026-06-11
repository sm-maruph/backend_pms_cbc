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
const authenticateToken = require('../middleware/auth'); // Your existing middleware

// Middleware to check if user is admin
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ 
            success: false, 
            message: 'Access denied. Admin rights required.' 
        });
    }
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