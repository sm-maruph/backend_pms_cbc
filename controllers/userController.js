const { poolPromise, sql } = require('../config/db');

// Get all users
exports.getAllUsers = async (req, res) => {
    try {
        const pool = await poolPromise;
        console.log('🔍 Executing query on Users table...');
        const result = await pool.request().query(`
            SELECT id, email, name, role, department, branch, created_at
            FROM Users
            ORDER BY name
        `);
        console.log('📊 Query result:', result.recordset);
        console.log('📊 Row count:', result.recordset.length);
        res.json(result.recordset);
    } catch (err) {
        console.error('❌ Users fetch error:', err);
        res.status(500).json({ message: 'Error fetching users', error: err.message });
    }
};

// Create user (admin only)
exports.createUser = async (req, res) => {
    const { email, name, role, department, branch, password } = req.body;
    if (!email || !name || !password) {
        return res.status(400).json({ message: 'Email, name, and password are required' });
    }
    try {
        const bcrypt = require('bcrypt');
        const hashed = await bcrypt.hash(password, 10);
        const pool = await poolPromise;
        await pool.request()
            .input('email', sql.NVarChar, email)
            .input('name', sql.NVarChar, name)
            .input('role', sql.NVarChar, role || 'user')
            .input('department', sql.NVarChar, department || null)
            .input('branch', sql.NVarChar, branch || null)
            .input('hash', sql.NVarChar, hashed)
            .query(`
                INSERT INTO Users (email, name, role, department, branch, password_hash)
                VALUES (@email, @name, @role, @department, @branch, @hash)
            `);
        res.status(201).json({ message: 'User created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error creating user' });
    }
};

// Update user
exports.updateUser = async (req, res) => {
    const { id } = req.params;
    const { name, role, department, branch, password } = req.body;
    try {
        const pool = await poolPromise;
        const request = pool.request().input('id', sql.Int, id);
        const updates = [];
        if (name) { updates.push('name = @name'); request.input('name', sql.NVarChar, name); }
        if (role) { updates.push('role = @role'); request.input('role', sql.NVarChar, role); }
        if (department !== undefined) { updates.push('department = @department'); request.input('department', sql.NVarChar, department); }
        if (branch !== undefined) { updates.push('branch = @branch'); request.input('branch', sql.NVarChar, branch); }
        if (password) {
            const bcrypt = require('bcrypt');
            const hashed = await bcrypt.hash(password, 10);
            updates.push('password_hash = @hash');
            request.input('hash', sql.NVarChar, hashed);
        }
        if (updates.length === 0) return res.status(400).json({ message: 'No fields to update' });
        await request.query(`UPDATE Users SET ${updates.join(', ')} WHERE id = @id`);
        res.json({ message: 'User updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating user' });
    }
};

// Delete user
exports.deleteUser = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Users WHERE id = @id');
        res.json({ message: 'User deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error deleting user' });
    }
};