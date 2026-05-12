const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { 
    // Systems
    getSystems, createSystem, updateSystem, deleteSystem,
    // Departments
    getDepartments, createDepartment, updateDepartment, deleteDepartment,
    // Branches
    getBranches, createBranch, updateBranch, deleteBranch,
    // Templates
    getTemplates, createTemplate, updateTemplate, deleteTemplate,
    // Favorites
    getUserFavorites, toggleFavorite
} = require('../controllers/staticController');

// Check if user is admin middleware
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

// ============================================================
// Systems routes
// ============================================================
router.get('/systems', getSystems);
router.post('/systems', auth, isAdmin, createSystem);
router.put('/systems/:id', auth, isAdmin, updateSystem);
router.delete('/systems/:id', auth, isAdmin, deleteSystem);

// ============================================================
// Departments routes
// ============================================================
router.get('/departments', getDepartments);
router.post('/departments', auth, isAdmin, createDepartment);
router.put('/departments/:id', auth, isAdmin, updateDepartment);
router.delete('/departments/:id', auth, isAdmin, deleteDepartment);

// ============================================================
// Branches routes
// ============================================================
router.get('/branches', getBranches);
router.post('/branches', auth, isAdmin, createBranch);
router.put('/branches/:id', auth, isAdmin, updateBranch);
router.delete('/branches/:id', auth, isAdmin, deleteBranch);

// ============================================================
// Templates routes
// ============================================================
router.get('/templates', getTemplates);
router.post('/templates', auth, isAdmin, createTemplate);
router.put('/templates/:id', auth, isAdmin, updateTemplate);
router.delete('/templates/:id', auth, isAdmin, deleteTemplate);

// ============================================================
// User favorites routes
// ============================================================
router.get('/favorites', auth, getUserFavorites);
router.post('/favorites/:templateId', auth, toggleFavorite);

module.exports = router;