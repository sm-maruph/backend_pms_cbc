const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const authenticateToken = require('../middleware/auth');  // Your existing auth
const admin = require('../middleware/admin');  // New admin middleware

// Get all audit logs (admin only)
router.get('/', authenticateToken, admin, async (req, res) => {
    try {
        const filters = {
            action_type: req.query.action_type,
            entity_type: req.query.entity_type,
            user_id: req.query.user_id,
            start_date: req.query.start_date,
            end_date: req.query.end_date
        };
        
        const logs = await AuditLog.getAll(filters);
        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get recent activities
router.get('/recent', authenticateToken, admin, async (req, res) => {
    try {
        const limit = req.query.limit || 50;
        const logs = await AuditLog.getRecentActivities(limit);
        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get audit summary
router.get('/summary', authenticateToken, admin, async (req, res) => {
    try {
        const summary = await AuditLog.getSummary();
        res.json({
            success: true,
            data: summary
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get audit logs for specific entity
router.get('/entity/:type/:id', authenticateToken, admin, async (req, res) => {
    try {
        const logs = await AuditLog.getByEntity(req.params.type, req.params.id);
        res.json({
            success: true,
            data: logs
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;