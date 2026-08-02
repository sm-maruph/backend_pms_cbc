// controllers/permissionController.js
const { poolPromise, sql } = require('../config/db');
const { clearPermissionCache } = require('../middleware/permissions');
const { logAction } = require('../services/auditService');
const { saveNotification } = require('./notificationController');

const ensureUserPermissionsTable = async (pool) => {
  await pool.request().query(`
    IF OBJECT_ID('user_permissions', 'U') IS NULL
    CREATE TABLE user_permissions (
      user_id INT NOT NULL,
      permission_id INT NOT NULL,
      granted_by INT NULL,
      granted_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
      CONSTRAINT PK_user_permissions PRIMARY KEY (user_id, permission_id)
    )
  `);
};

const notifyPermissionChange = async (req, user, title, message, metadata = {}) => {
  if (!user?.email) return;
  const notification = { type: 'permission', title, message };
  await saveNotification(user.email, notification, null, metadata);
  req.app.get('emitToUser')?.(user.email, 'permission-updated', {
    ...notification, user_id: user.id, metadata, changed_at: new Date().toISOString()
  });
  req.app.get('emitToUser')?.(user.email, 'notification', notification);
};

// ── GET all roles with counts ─────────────────────────────────────────────────
exports.getRoles = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT r.id, r.name, r.description, r.is_system, r.created_at,
        COUNT(DISTINCT rp.permission_id) AS permission_count,
        COUNT(DISTINCT u.id) AS user_count
      FROM roles r
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN Users u ON u.role_id = r.id
      GROUP BY r.id, r.name, r.description, r.is_system, r.created_at
      ORDER BY r.id
    `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('getRoles error:', err);
    res.status(500).json({ message: err.message });
  }
};

// ── GET all permissions grouped by module ─────────────────────────────────────
exports.getPermissions = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(
      'SELECT * FROM permissions ORDER BY module, name'
    );
    const grouped = {};
    result.recordset.forEach(p => {
      if (!grouped[p.module]) grouped[p.module] = [];
      grouped[p.module].push(p);
    });
    res.json({ success: true, data: result.recordset, grouped });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET permissions for a specific role ───────────────────────────────────────
exports.getRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const pool = await poolPromise;
    const result = await pool.request()
      .input('roleId', sql.Int, roleId)
      .query(`
        SELECT p.*
        FROM role_permissions rp
        INNER JOIN permissions p ON rp.permission_id = p.id
        WHERE rp.role_id = @roleId
        ORDER BY p.module, p.name
      `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PUT update role permissions ───────────────────────────────────────────────
exports.updateRolePermissions = async (req, res) => {
  try {
    const { roleId } = req.params;
    const { permission_ids } = req.body; // number[]
    const pool = await poolPromise;

    const roleCheck = await pool.request()
      .input('roleId', sql.Int, roleId)
      .query('SELECT id, name, is_system FROM roles WHERE id = @roleId');

    if (!roleCheck.recordset[0])
      return res.status(404).json({ message: 'Role not found' });

    const previous = await pool.request()
      .input('roleId', sql.Int, roleId)
      .query('SELECT permission_id FROM role_permissions WHERE role_id = @roleId');

    // Delete existing
    await pool.request()
      .input('roleId', sql.Int, roleId)
      .query('DELETE FROM role_permissions WHERE role_id = @roleId');

    // Insert new
    if (Array.isArray(permission_ids) && permission_ids.length > 0) {
      for (const permId of permission_ids) {
        await pool.request()
          .input('roleId',    sql.Int, roleId)
          .input('permId',    sql.Int, permId)
          .input('grantedBy', sql.Int, req.user.id)
          .query(`
            INSERT INTO role_permissions (role_id, permission_id, granted_by)
            VALUES (@roleId, @permId, @grantedBy)
          `);
      }
    }

    // Clear cache for all users with this role
    const users = await pool.request()
      .input('roleId', sql.Int, roleId)
      .query('SELECT id, name, email FROM Users WHERE role_id = @roleId');
    users.recordset.forEach(u => clearPermissionCache(u.id));

    await Promise.all(users.recordset.map(user => notifyPermissionChange(
      req, user, 'Your access was updated',
      `Permissions for ${roleCheck.recordset[0].name} were updated and are active now.`,
      { role_id: Number(roleId), permission_ids }
    )));
    await logAction(req, 'UPDATE', 'ROLE_PERMISSION', roleId,
      { permission_ids: previous.recordset.map(item => item.permission_id) },
      { permission_ids },
      { affected_users: users.recordset.length });
    req.app.get('emitToAll')?.('roles-permissions-updated', { type: 'role-permissions', role_id: Number(roleId) });

    res.json({ success: true, message: 'Permissions updated successfully' });
  } catch (err) {
    console.error('updateRolePermissions error:', err);
    res.status(500).json({ message: err.message });
  }
};

// ── POST create new role ──────────────────────────────────────────────────────
exports.createRole = async (req, res) => {
  try {
    const { name, description, permission_ids = [] } = req.body;
    const pool = await poolPromise;

    const result = await pool.request()
      .input('name',        sql.NVarChar, name)
      .input('description', sql.NVarChar, description || '')
      .input('createdBy',   sql.Int,      req.user.id)
      .query(`
        INSERT INTO roles (name, description, is_system, created_by)
        OUTPUT INSERTED.id
        VALUES (@name, @description, 0, @createdBy)
      `);

    const newRoleId = result.recordset[0].id;

    for (const permId of permission_ids) {
      await pool.request()
        .input('roleId',    sql.Int, newRoleId)
        .input('permId',    sql.Int, permId)
        .input('grantedBy', sql.Int, req.user.id)
        .query(`
          INSERT INTO role_permissions (role_id, permission_id, granted_by)
          VALUES (@roleId, @permId, @grantedBy)
        `);
    }

    await logAction(req, 'CREATE', 'ROLE', newRoleId, null,
      { name, description: description || '', permission_ids });
    req.app.get('emitToAll')?.('roles-permissions-updated', { type: 'role-created', role_id: newRoleId });
    res.status(201).json({ success: true, message: 'Role created', role_id: newRoleId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── DELETE role ───────────────────────────────────────────────────────────────
exports.deleteRole = async (req, res) => {
  try {
    const { roleId } = req.params;
    const pool = await poolPromise;

    const check = await pool.request()
      .input('roleId', sql.Int, roleId)
      .query('SELECT id, name, description, is_system FROM roles WHERE id = @roleId');

    if (check.recordset[0]?.is_system)
      return res.status(400).json({ message: 'Cannot delete system-defined roles' });

    // Reassign users in this role → IT User (role_id=3 by default)
    await pool.request()
      .input('roleId', sql.Int, roleId)
      .query('UPDATE Users SET role_id = 3 WHERE role_id = @roleId');

    await pool.request()
      .input('roleId', sql.Int, roleId)
      .query('DELETE FROM roles WHERE id = @roleId');

    clearPermissionCache(); // clear all
    await logAction(req, 'DELETE', 'ROLE', roleId, check.recordset[0], null);
    req.app.get('emitToAll')?.('roles-permissions-updated', { type: 'role-deleted', role_id: Number(roleId) });
    res.json({ success: true, message: 'Role deleted. Affected users reassigned to IT User.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── PUT assign role to user ───────────────────────────────────────────────────
exports.assignUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { role_id } = req.body;
    const pool = await poolPromise;
    const userResult = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT id, name, email, role_id FROM Users WHERE id = @userId');
    const targetUser = userResult.recordset[0];
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    // Validate role exists
    const roleCheck = await pool.request()
      .input('roleId', sql.Int, role_id)
      .query('SELECT id, name FROM roles WHERE id = @roleId');

    if (!roleCheck.recordset[0])
      return res.status(404).json({ message: 'Role not found' });

    await pool.request()
      .input('userId', sql.Int, userId)
      .input('roleId', sql.Int, role_id)
      .query('UPDATE Users SET role_id = @roleId WHERE id = @userId');

    clearPermissionCache(parseInt(userId));
    await notifyPermissionChange(
      req, targetUser, 'You were assigned to a new role group',
      `You are now a member of ${roleCheck.recordset[0].name}. Your access is active immediately.`,
      { old_role_id: targetUser.role_id, role_id: Number(role_id), role_name: roleCheck.recordset[0].name }
    );
    await logAction(req, 'ASSIGN', 'USER_ROLE', userId,
      { role_id: targetUser.role_id },
      { role_id: Number(role_id), role_name: roleCheck.recordset[0].name });
    const updatedUser = {
      ...targetUser,
      role_id: Number(role_id),
      role: roleCheck.recordset[0].name
    };
    req.app.get('emitToAll')?.('users-updated', { action: 'role-assigned', user: updatedUser });
    req.app.get('emitToUser')?.(targetUser.email, 'profile-updated', { user: updatedUser });
    req.app.get('emitToAll')?.('roles-permissions-updated', { type: 'role-assigned', user_id: Number(userId) });

    res.json({
      success: true,
      message: `Role "${roleCheck.recordset[0].name}" assigned successfully`
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET my permissions ─────────────────────────────────────────────────────────
exports.getMyPermissions = async (req, res) => {
  try {
    if (req.user.role === 'Super Admin') {
      const pool = await poolPromise;
      const all = await pool.request().query('SELECT name FROM permissions');
      return res.json({
        success: true,
        permissions: all.recordset.map(p => p.name),
        role: req.user.role,
        role_id: req.user.role_id
      });
    }
    const pool = await poolPromise;
    await ensureUserPermissionsTable(pool);
    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .query(`
        SELECT p.name FROM Users u
        INNER JOIN roles r ON u.role_id = r.id
        INNER JOIN role_permissions rp ON r.id = rp.role_id
        INNER JOIN permissions p ON rp.permission_id = p.id
        WHERE u.id = @userId
        UNION
        SELECT p.name FROM user_permissions up
        INNER JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = @userId
      `);
    res.json({
      success: true,
      permissions: result.recordset.map(p => p.name),
      role: req.user.role,
      role_id: req.user.role_id
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET visibility dashboard for Super Admin
exports.getPermissionDashboard = async (req, res) => {
  try {
    const pool = await poolPromise;
    await ensureUserPermissionsTable(pool);
    const summary = await pool.request().query(`
      SELECT
        (SELECT COUNT(*) FROM roles) AS total_groups,
        (SELECT COUNT(*) FROM Users) AS total_users,
        (SELECT COUNT(*) FROM permissions) AS total_permissions,
        (SELECT COUNT(*) FROM Users WHERE role_id IS NULL) AS users_without_group,
        (SELECT COUNT(DISTINCT user_id) FROM user_permissions) AS users_with_direct_grants,
        (SELECT COUNT(*) FROM user_permissions) AS direct_grants
    `);
    const groups = await pool.request().query(`
      SELECT r.id, r.name, r.is_system,
        COUNT(DISTINCT u.id) AS user_count,
        COUNT(DISTINCT rp.permission_id) AS permission_count
      FROM roles r
      LEFT JOIN Users u ON u.role_id = r.id
      LEFT JOIN role_permissions rp ON rp.role_id = r.id
      GROUP BY r.id, r.name, r.is_system
      ORDER BY user_count DESC, r.name
    `);
    res.json({ success: true, summary: summary.recordset[0], groups: groups.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET direct permission grants for one user
exports.getUserPermissions = async (req, res) => {
  try {
    const pool = await poolPromise;
    await ensureUserPermissionsTable(pool);
    const result = await pool.request()
      .input('userId', sql.Int, req.params.userId)
      .query(`
        SELECT p.id, p.name, p.module, p.description, up.granted_at
        FROM user_permissions up
        INNER JOIN permissions p ON p.id = up.permission_id
        WHERE up.user_id = @userId
        ORDER BY p.module, p.name
      `);
    res.json({ success: true, data: result.recordset });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// PUT replace direct permission grants for one user
exports.updateUserPermissions = async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const permissionIds = Array.isArray(req.body.permission_ids)
      ? [...new Set(req.body.permission_ids.map(Number).filter(Number.isInteger))]
      : [];
    const pool = await poolPromise;
    await ensureUserPermissionsTable(pool);

    const userResult = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT id, name, email FROM Users WHERE id = @userId');
    const targetUser = userResult.recordset[0];
    if (!targetUser) return res.status(404).json({ message: 'User not found' });

    const previous = await pool.request()
      .input('userId', sql.Int, userId)
      .query('SELECT permission_id FROM user_permissions WHERE user_id = @userId');

    await pool.request()
      .input('userId', sql.Int, userId)
      .query('DELETE FROM user_permissions WHERE user_id = @userId');

    for (const permissionId of permissionIds) {
      await pool.request()
        .input('userId', sql.Int, userId)
        .input('permissionId', sql.Int, permissionId)
        .input('grantedBy', sql.Int, req.user.id)
        .query(`
          INSERT INTO user_permissions (user_id, permission_id, granted_by)
          SELECT @userId, @permissionId, @grantedBy
          WHERE EXISTS (SELECT 1 FROM permissions WHERE id = @permissionId)
        `);
    }

    clearPermissionCache(userId);
    await notifyPermissionChange(
      req, targetUser, 'Your individual permissions changed',
      'Your access permissions were updated by Super Admin and are active immediately.',
      { permission_ids: permissionIds }
    );
    await logAction(req, 'UPDATE', 'USER_PERMISSION', userId,
      { permission_ids: previous.recordset.map(item => item.permission_id) },
      { permission_ids: permissionIds });
    req.app.get('emitToAll')?.('roles-permissions-updated', { type: 'user-permissions', user_id: userId });

    res.json({ success: true, message: 'User permissions updated', permission_ids: permissionIds });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
