// routes/permissionRoutes.js
const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const pc      = require('../controllers/permissionController');

// Only Super Admin can manage roles/permissions
const superAdminOnly = (req, res, next) => {
  if (req.user?.role === 'Super Admin') return next();
  return res.status(403).json({ message: 'Super Admin access required.' });
};

// ── My permissions (any authenticated user) ───────────────────────────────────
router.get('/auth/my-permissions', auth, pc.getMyPermissions);

// ── Role management ───────────────────────────────────────────────────────────
router.get('/admin/roles',                     auth, superAdminOnly, pc.getRoles);
router.post('/admin/roles',                    auth, superAdminOnly, pc.createRole);
router.delete('/admin/roles/:roleId',          auth, superAdminOnly, pc.deleteRole);
router.get('/admin/roles/:roleId/permissions', auth, superAdminOnly, pc.getRolePermissions);
router.put('/admin/roles/:roleId/permissions', auth, superAdminOnly, pc.updateRolePermissions);

// ── All permissions list ──────────────────────────────────────────────────────
router.get('/admin/permissions', auth, superAdminOnly, pc.getPermissions);

// ── Assign role to user ───────────────────────────────────────────────────────
router.put('/admin/users/:userId/role', auth, superAdminOnly, pc.assignUserRole);

module.exports = router;
