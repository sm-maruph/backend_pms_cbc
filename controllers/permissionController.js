// controllers/permissionController.js
const { poolPromise, sql } = require('../config/db');
const { clearPermissionCache } = require('../middleware/permissions');

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
      .query('SELECT id, is_system FROM roles WHERE id = @roleId');

    if (!roleCheck.recordset[0])
      return res.status(404).json({ message: 'Role not found' });

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
      .query('SELECT id FROM Users WHERE role_id = @roleId');
    users.recordset.forEach(u => clearPermissionCache(u.id));

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
      .query('SELECT is_system FROM roles WHERE id = @roleId');

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
    const result = await pool.request()
      .input('userId', sql.Int, req.user.id)
      .query(`
        SELECT p.name FROM Users u
        INNER JOIN roles r ON u.role_id = r.id
        INNER JOIN role_permissions rp ON r.id = rp.role_id
        INNER JOIN permissions p ON rp.permission_id = p.id
        WHERE u.id = @userId
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
