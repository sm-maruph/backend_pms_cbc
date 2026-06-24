// middleware/permissions.js
const { poolPromise, sql } = require('../config/db');

// In-memory permission cache: userId → { perms: string[], ts: number }
const permissionCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getPermissions = async (userId) => {
  const cached = permissionCache.get(userId);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.perms;

  const pool = await poolPromise;
  const result = await pool.request()
    .input('userId', sql.Int, userId)
    .query(`
      SELECT p.name
      FROM Users u
      INNER JOIN roles r ON u.role_id = r.id
      INNER JOIN role_permissions rp ON r.id = rp.role_id
      INNER JOIN permissions p ON rp.permission_id = p.id
      WHERE u.id = @userId
    `);

  const perms = result.recordset.map(r => r.name);
  permissionCache.set(userId, { perms, ts: Date.now() });
  return perms;
};

const clearPermissionCache = (userId) => {
  if (userId) permissionCache.delete(userId);
  else permissionCache.clear();
};

const requirePermission = (permission) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    if (req.user.role === 'Super Admin') return next();

    const perms = await getPermissions(req.user.id);
    if (perms.includes(permission)) return next();

    console.log(`❌ Permission denied: ${req.user.email} needs ${permission} (role: ${req.user.role})`);
    return res.status(403).json({
      message: `Access denied. Required permission: ${permission}`,
      your_role: req.user.role,
      required: permission
    });
  } catch (err) {
    console.error('Permission middleware error:', err);
    return res.status(500).json({ message: 'Permission check failed' });
  }
};

const requireAnyPermission = (...permissions) => async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    if (req.user.role === 'Super Admin') return next();

    const perms = await getPermissions(req.user.id);
    if (permissions.some(p => perms.includes(p))) return next();

    return res.status(403).json({
      message: `Access denied. Required one of: ${permissions.join(', ')}`,
      your_role: req.user.role
    });
  } catch (err) {
    return res.status(500).json({ message: 'Permission check failed' });
  }
};

const attachPermissions = async (req, res, next) => {
  try {
    if (req.user) {
      if (req.user.role === 'Super Admin') {
        req.permissions = ['*'];
      } else {
        req.permissions = await getPermissions(req.user.id);
      }
      req.hasPermission = (perm) =>
        req.permissions.includes('*') || req.permissions.includes(perm);
    }
    next();
  } catch (err) {
    next();
  }
};

module.exports = { requirePermission, requireAnyPermission, attachPermissions, clearPermissionCache, getPermissions };
