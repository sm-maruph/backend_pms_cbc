const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { 
    getUserNotifications, 
    getUnreadCount, 
    markAsRead, 
    markAllAsRead 
} = require('../controllers/notificationController');

router.get('/', auth, getUserNotifications);
router.get('/unread-count', auth, getUnreadCount);
router.put('/:id/read', auth, markAsRead);
router.put('/mark-all-read', auth, markAllAsRead);

module.exports = router;