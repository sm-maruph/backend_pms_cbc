const express        = require('express');
const router         = express.Router();
const auth           = require('../middleware/auth');
const admin          = require('../middleware/admin');
const userController = require('../controllers/userController');

let requirePermission, requireAnyPermission, attachPermissions;
try {
  const perms      = require('../middleware/permissions');
  requirePermission    = typeof perms.requirePermission    === 'function' ? perms.requirePermission    : null;
  requireAnyPermission = typeof perms.requireAnyPermission === 'function' ? perms.requireAnyPermission : null;
  attachPermissions    = typeof perms.attachPermissions    === 'function' ? perms.attachPermissions    : null;
} catch (e) {
  console.warn('permissions middleware not loaded:', e.message);
}

const perm    = (p)     => requirePermission    ? requirePermission(p)        : admin;
const permAny = (...ps) => requireAnyPermission ? requireAnyPermission(...ps) : auth;
const attach  = attachPermissions || ((req, res, next) => next());
const safe    = (fn, name) => typeof fn === 'function' ? fn : (req, res) => res.status(501).json({ message: `Not implemented: ${name}` });

router.use(auth);
router.use(attach);

router.get('/activity-stats', permAny('activity.view','dashboard.view'), safe(userController.getUserActivityStats,'getUserActivityStats'));
router.get('/assignable',     safe(userController.getAssignableUsers,'getAssignableUsers'));
router.get('/',               perm('user.view.all'),  safe(userController.getAllUsers,'getAllUsers'));
router.post('/',              perm('user.create'),    safe(userController.createUser,'createUser'));
router.put('/:id/role',       perm('user.assign.role'), safe(userController.assignRole,'assignRole'));
router.put('/:id',            perm('user.edit'),      safe(userController.updateUser,'updateUser'));
router.delete('/:id',         perm('user.delete'),    safe(userController.deleteUser,'deleteUser'));

module.exports = router;