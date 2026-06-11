const Announcement = require('../models/Announcement');

// @desc    Get all announcements
// @route   GET /api/announcements
// @access  Private (Admin only)
const getAnnouncements = async (req, res) => {
    try {
        const announcements = await Announcement.getAll();
        res.json({
            success: true,
            data: announcements
        });
    } catch (error) {
        console.error('Error fetching announcements:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch announcements',
            error: error.message 
        });
    }
};

// @desc    Get active announcements (for users)
// @route   GET /api/announcements/active
// @access  Private
const getActiveAnnouncements = async (req, res) => {
    try {
        const announcements = await Announcement.getActive();
        res.json({
            success: true,
            data: announcements
        });
    } catch (error) {
        console.error('Error fetching active announcements:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch active announcements',
            error: error.message 
        });
    }
};

// @desc    Get single announcement
// @route   GET /api/announcements/:id
// @access  Private (Admin only)
const getAnnouncementById = async (req, res) => {
    try {
        const announcement = await Announcement.getById(parseInt(req.params.id));
        
        if (!announcement) {
            return res.status(404).json({ 
                success: false, 
                message: 'Announcement not found' 
            });
        }
        
        res.json({
            success: true,
            data: announcement
        });
    } catch (error) {
        console.error('Error fetching announcement:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch announcement',
            error: error.message 
        });
    }
};

// @desc    Create announcement
// @route   POST /api/announcements
// @access  Private (Admin only)
const createAnnouncement = async (req, res) => {
    try {
        const { title, content, priority, expires_at, is_active } = req.body;
        
        // Validate required fields
        if (!title || !content) {
            return res.status(400).json({ 
                success: false, 
                message: 'Title and content are required' 
            });
        }
        
        const announcementData = {
            title,
            content,
            priority: priority || 'normal',
            is_active: is_active !== undefined ? is_active : true,
            expires_at: expires_at || null,
            created_by: req.user.id,
            created_by_name: req.user.name
        };
        
        const announcement = await Announcement.create(announcementData);
        
        // Emit socket event for real-time update
        const emitToAll = req.app.get('emitToAll');
        if (emitToAll && announcement) {
            emitToAll('new_announcement', announcement);
        }
        
        res.status(201).json({
            success: true,
            message: 'Announcement created successfully',
            data: announcement
        });
    } catch (error) {
        console.error('Error creating announcement:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create announcement',
            error: error.message 
        });
    }
};

// @desc    Update announcement
// @route   PUT /api/announcements/:id
// @access  Private (Admin only)
const updateAnnouncement = async (req, res) => {
    try {
        const { title, content, priority, expires_at, is_active } = req.body;
        
        const existingAnnouncement = await Announcement.getById(parseInt(req.params.id));
        
        if (!existingAnnouncement) {
            return res.status(404).json({ 
                success: false, 
                message: 'Announcement not found' 
            });
        }
        
        const updateData = {
            title: title || existingAnnouncement.title,
            content: content || existingAnnouncement.content,
            priority: priority || existingAnnouncement.priority,
            is_active: is_active !== undefined ? is_active : existingAnnouncement.is_active,
            expires_at: expires_at !== undefined ? expires_at : existingAnnouncement.expires_at
        };
        
        const announcement = await Announcement.update(parseInt(req.params.id), updateData);
        
        // Emit socket event for real-time update
        const emitToAll = req.app.get('emitToAll');
        if (emitToAll && announcement) {
            emitToAll('announcement_updated', announcement);
        }
        
        res.json({
            success: true,
            message: 'Announcement updated successfully',
            data: announcement
        });
    } catch (error) {
        console.error('Error updating announcement:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to update announcement',
            error: error.message 
        });
    }
};

// @desc    Delete announcement
// @route   DELETE /api/announcements/:id
// @access  Private (Admin only)
const deleteAnnouncement = async (req, res) => {
    try {
        const existingAnnouncement = await Announcement.getById(parseInt(req.params.id));
        
        if (!existingAnnouncement) {
            return res.status(404).json({ 
                success: false, 
                message: 'Announcement not found' 
            });
        }
        
        await Announcement.delete(parseInt(req.params.id));
        
        // Emit socket event for real-time update
        const emitToAll = req.app.get('emitToAll');
        if (emitToAll) {
            emitToAll('announcement_deleted', { id: parseInt(req.params.id) });
        }
        
        res.json({
            success: true,
            message: 'Announcement deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting announcement:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to delete announcement',
            error: error.message 
        });
    }
};

// @desc    Toggle announcement status (activate/deactivate)
// @route   PATCH /api/announcements/:id/toggle
// @access  Private (Admin only)
const toggleAnnouncementStatus = async (req, res) => {
    try {
        const existingAnnouncement = await Announcement.getById(parseInt(req.params.id));
        
        if (!existingAnnouncement) {
            return res.status(404).json({ 
                success: false, 
                message: 'Announcement not found' 
            });
        }
        
        const newStatus = await Announcement.toggleStatus(parseInt(req.params.id));
        const updatedAnnouncement = await Announcement.getById(parseInt(req.params.id));
        
        // Emit socket event for real-time update
        const emitToAll = req.app.get('emitToAll');
        if (emitToAll && updatedAnnouncement) {
            emitToAll('announcement_toggled', updatedAnnouncement);
        }
        
        res.json({
            success: true,
            message: `Announcement ${newStatus ? 'activated' : 'deactivated'}`,
            data: updatedAnnouncement
        });
    } catch (error) {
        console.error('Error toggling announcement:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to toggle announcement status',
            error: error.message 
        });
    }
};

module.exports = {
    getAnnouncements,
    getActiveAnnouncements,
    getAnnouncementById,
    createAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    toggleAnnouncementStatus,
};