const express          = require('express');
const router           = express.Router();
const auth             = require('../middleware/auth');
const admin            = require('../middleware/admin');
const staticController = require('../controllers/staticController');

let requirePermission, attachPermissions;
try {
  const perms      = require('../middleware/permissions');
  requirePermission = typeof perms.requirePermission === 'function' ? perms.requirePermission : null;
  attachPermissions = typeof perms.attachPermissions === 'function' ? perms.attachPermissions : null;
} catch (e) {
  console.warn('permissions middleware not loaded in staticRoutes:', e.message);
}

const perm   = (p) => requirePermission ? requirePermission(p) : admin;
const attach = attachPermissions || ((req, res, next) => next());
const safe   = (fn, name) => typeof fn === 'function' ? fn : (req, res) => res.status(501).json({ message: `Not implemented: ${name}` });

router.use(auth);
router.use(attach);

// Systems
router.get('/systems',        safe(staticController.getSystems,      'getSystems'));
router.post('/systems',       perm('system.create'), safe(staticController.createSystem,    'createSystem'));
router.put('/systems/:id',    perm('system.edit'),   safe(staticController.updateSystem,    'updateSystem'));
router.delete('/systems/:id', perm('system.delete'), safe(staticController.deleteSystem,    'deleteSystem'));

// Departments
router.get('/departments',        safe(staticController.getDepartments,    'getDepartments'));
router.post('/departments',       perm('department.create'), safe(staticController.createDepartment,  'createDepartment'));
router.put('/departments/:id',    perm('department.edit'),   safe(staticController.updateDepartment,  'updateDepartment'));
router.delete('/departments/:id', perm('department.delete'), safe(staticController.deleteDepartment,  'deleteDepartment'));

// Branches
router.get('/branches',        safe(staticController.getBranches,   'getBranches'));
router.post('/branches',       perm('branch.create'), safe(staticController.createBranch,  'createBranch'));
router.put('/branches/:id',    perm('branch.edit'),   safe(staticController.updateBranch,  'updateBranch'));
router.delete('/branches/:id', perm('branch.delete'), safe(staticController.deleteBranch,  'deleteBranch'));

// Templates
router.get('/templates',        safe(staticController.getTemplates,   'getTemplates'));
router.post('/templates',       perm('template.create'), safe(staticController.createTemplate,  'createTemplate'));
router.put('/templates/:id',    perm('template.edit'),   safe(staticController.updateTemplate,  'updateTemplate'));
router.delete('/templates/:id', perm('template.delete'), safe(staticController.deleteTemplate,  'deleteTemplate'));

// Favorites (no permission change needed)
router.get('/favorites',        auth, safe(staticController.getUserFavorites, 'getUserFavorites'));
router.post('/favorites/:id',   auth, safe(staticController.toggleFavorite,   'toggleFavorite'));

module.exports = router;