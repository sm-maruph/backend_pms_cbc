const { poolPromise, sql } = require('../config/db');

// ============================================================
// SYSTEMS CRUD
// ============================================================

// Get all systems
exports.getSystems = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT name FROM Systems ORDER BY name');
        const systems = result.recordset.map(row => row.name);
        res.json(systems);
    } catch (err) {
        console.error('Error fetching systems:', err);
        res.status(500).json({ message: 'Error fetching systems', error: err.message });
    }
};

// Create system
exports.createSystem = async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ message: 'System name is required' });
    }
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('name', sql.NVarChar, name.trim())
            .query('INSERT INTO Systems (name) VALUES (@name)');
        res.status(201).json({ message: 'System created successfully' });
    } catch (err) {
        if (err.number === 2627) { // Duplicate key error
            return res.status(409).json({ message: 'System already exists' });
        }
        console.error(err);
        res.status(500).json({ message: 'Error creating system' });
    }
};

// Update system
exports.updateSystem = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('id', sql.Int, id);
        
        let query = 'UPDATE Systems SET ';
        const updates = [];
        
        if (name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
        }
        if (is_active !== undefined) {
            updates.push('is_active = @is_active');
            request.input('is_active', sql.Bit, is_active);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }
        
        query += updates.join(', ') + ' WHERE id = @id';
        await request.query(query);
        res.json({ message: 'System updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating system' });
    }
};

// Delete system
exports.deleteSystem = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Systems WHERE id = @id');
        res.json({ message: 'System deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error deleting system' });
    }
};

// ============================================================
// DEPARTMENTS CRUD
// ============================================================

// Get all departments
exports.getDepartments = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT name FROM Departments ORDER BY name');
        const departments = result.recordset.map(row => row.name);
        res.json(departments);
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.status(500).json({ message: 'Error fetching departments', error: err.message });
    }
};

// Create department
exports.createDepartment = async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Department name is required' });
    }
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('name', sql.NVarChar, name.trim())
            .query('INSERT INTO Departments (name) VALUES (@name)');
        res.status(201).json({ message: 'Department created successfully' });
    } catch (err) {
        if (err.number === 2627) {
            return res.status(409).json({ message: 'Department already exists' });
        }
        console.error(err);
        res.status(500).json({ message: 'Error creating department' });
    }
};

// Update department
exports.updateDepartment = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('id', sql.Int, id);
        
        let query = 'UPDATE Departments SET ';
        const updates = [];
        
        if (name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
        }
        if (is_active !== undefined) {
            updates.push('is_active = @is_active');
            request.input('is_active', sql.Bit, is_active);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }
        
        query += updates.join(', ') + ' WHERE id = @id';
        await request.query(query);
        res.json({ message: 'Department updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating department' });
    }
};

// Delete department
exports.deleteDepartment = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Departments WHERE id = @id');
        res.json({ message: 'Department deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error deleting department' });
    }
};

// ============================================================
// BRANCHES CRUD
// ============================================================

// Get all branches
exports.getBranches = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT name FROM Branches ORDER BY name');
        const branches = result.recordset.map(row => row.name);
        res.json(branches);
    } catch (err) {
        console.error('Error fetching branches:', err);
        res.status(500).json({ message: 'Error fetching branches', error: err.message });
    }
};

// Create branch
exports.createBranch = async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ message: 'Branch name is required' });
    }
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('name', sql.NVarChar, name.trim())
            .query('INSERT INTO Branches (name) VALUES (@name)');
        res.status(201).json({ message: 'Branch created successfully' });
    } catch (err) {
        if (err.number === 2627) {
            return res.status(409).json({ message: 'Branch already exists' });
        }
        console.error(err);
        res.status(500).json({ message: 'Error creating branch' });
    }
};

// Update branch
exports.updateBranch = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('id', sql.Int, id);
        
        let query = 'UPDATE Branches SET ';
        const updates = [];
        
        if (name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
        }
        if (is_active !== undefined) {
            updates.push('is_active = @is_active');
            request.input('is_active', sql.Bit, is_active);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }
        
        query += updates.join(', ') + ' WHERE id = @id';
        await request.query(query);
        res.json({ message: 'Branch updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating branch' });
    }
};

// Delete branch
exports.deleteBranch = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Branches WHERE id = @id');
        res.json({ message: 'Branch deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error deleting branch' });
    }
};

// ============================================================
// TEMPLATES CRUD
// ============================================================

// Get all templates
exports.getTemplates = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT id, name, category, icon_name, gradient_color, bg_color, text_color,
                   system_name, department, problem_details, risk_label, affected_user
            FROM Templates ORDER BY name
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching templates:', err);
        res.status(500).json({ message: 'Error fetching templates', error: err.message });
    }
};

// Create template
exports.createTemplate = async (req, res) => {
    const { id, name, category, icon_name, gradient_color, bg_color, text_color,
            system_name, department, problem_details, risk_label, affected_user } = req.body;
    
    if (!id || !name || !category) {
        return res.status(400).json({ message: 'ID, Name and Category are required' });
    }
    
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.NVarChar, id)
            .input('name', sql.NVarChar, name)
            .input('category', sql.NVarChar, category)
            .input('icon_name', sql.NVarChar, icon_name || 'Shield')
            .input('gradient_color', sql.NVarChar, gradient_color || 'from-blue-500 to-blue-600')
            .input('bg_color', sql.NVarChar, bg_color || 'bg-blue-50')
            .input('text_color', sql.NVarChar, text_color || 'text-blue-700')
            .input('system_name', sql.NVarChar, system_name)
            .input('department', sql.NVarChar, department)
            .input('problem_details', sql.NVarChar, problem_details)
            .input('risk_label', sql.NVarChar, risk_label || 'MEDIUM')
            .input('affected_user', sql.NVarChar, affected_user || '')
            .query(`
                INSERT INTO Templates (id, name, category, icon_name, gradient_color, bg_color, text_color,
                                       system_name, department, problem_details, risk_label, affected_user)
                VALUES (@id, @name, @category, @icon_name, @gradient_color, @bg_color, @text_color,
                        @system_name, @department, @problem_details, @risk_label, @affected_user)
            `);
        res.status(201).json({ message: 'Template created successfully' });
    } catch (err) {
        if (err.number === 2627) {
            return res.status(409).json({ message: 'Template ID already exists' });
        }
        console.error(err);
        res.status(500).json({ message: 'Error creating template' });
    }
};

// Update template
exports.updateTemplate = async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    try {
        const pool = await poolPromise;
        const request = pool.request()
            .input('id', sql.NVarChar, id);
        
        const allowedFields = ['name', 'category', 'icon_name', 'gradient_color', 'bg_color', 
                               'text_color', 'system_name', 'department', 'problem_details', 
                               'risk_label', 'affected_user', 'is_active'];
        const setClause = [];
        
        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                setClause.push(`${field} = @${field}`);
                request.input(field, sql.NVarChar, updates[field]);
            }
        }
        
        if (setClause.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }
        
        await request.query(`UPDATE Templates SET ${setClause.join(', ')} WHERE id = @id`);
        res.json({ message: 'Template updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating template' });
    }
};

// Delete template
exports.deleteTemplate = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.NVarChar, id)
            .query('DELETE FROM Templates WHERE id = @id');
        res.json({ message: 'Template deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error deleting template' });
    }
};

// ============================================================
// USER FAVORITES
// ============================================================

// Get user's favorite templates
exports.getUserFavorites = async (req, res) => {
    const userEmail = req.user.email;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('email', sql.NVarChar, userEmail)
            .query('SELECT template_id FROM UserFavorites WHERE user_email = @email');
        res.json(result.recordset.map(row => row.template_id));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching favorites' });
    }
};

// Toggle favorite template
exports.toggleFavorite = async (req, res) => {
    const userEmail = req.user.email;
    const { templateId } = req.params;
    try {
        const pool = await poolPromise;
        const check = await pool.request()
            .input('email', sql.NVarChar, userEmail)
            .input('templateId', sql.NVarChar, templateId)
            .query('SELECT 1 FROM UserFavorites WHERE user_email = @email AND template_id = @templateId');
        
        if (check.recordset.length > 0) {
            await pool.request()
                .input('email', sql.NVarChar, userEmail)
                .input('templateId', sql.NVarChar, templateId)
                .query('DELETE FROM UserFavorites WHERE user_email = @email AND template_id = @templateId');
            res.json({ message: 'Favorite removed', isFavorite: false });
        } else {
            await pool.request()
                .input('email', sql.NVarChar, userEmail)
                .input('templateId', sql.NVarChar, templateId)
                .query('INSERT INTO UserFavorites (user_email, template_id) VALUES (@email, @templateId)');
            res.json({ message: 'Favorite added', isFavorite: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error toggling favorite' });
    }
};