const { poolPromise, sql } = require('../config/db');
const { logAction } = require('../services/auditService');


// Helper to get client IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.ip ||
        'unknown';
};


// ============================================================
// SYSTEMS CRUD
// ============================================================

// Get all systems
exports.getSystems = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query('SELECT id, name FROM Systems ORDER BY name');
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching systems:', err);
        res.status(500).json({ message: 'Error fetching systems', error: err.message });
    }
};

// Create system
// Create system with audit log
exports.createSystem = async (req, res) => {
    try {
        const { name } = req.body;
        const ip_address = getClientIp(req);
        const currentTime = new Date(); // ← Get current time (matches down_time approach)


        if (!name) {
            return res.status(400).json({ message: 'System name is required' });
        }

        const pool = await poolPromise;

        // Check if system already exists
        const checkResult = await pool.request()
            .input('name', sql.NVarChar, name)
            .query('SELECT id FROM systems WHERE name = @name');

        if (checkResult.recordset.length > 0) {
            return res.status(400).json({ message: 'System already exists' });
        }

        // Insert new system
        const result = await pool.request()
            .input('name', sql.NVarChar, name)
            .query(`
                INSERT INTO systems (name, created_at)
                OUTPUT INSERTED.id, INSERTED.name, INSERTED.created_at
                VALUES (@name, GETDATE())
            `);

        const newSystem = result.recordset[0];

        // ✅ LOG: System creation with IP
        await logAction(
            req,
            'CREATE',
            'SYSTEM',
            newSystem.id,
            null,
            {
                id: newSystem.id,
                name: newSystem.name,
                created_at: newSystem.created_at
            },
            {
                action: 'create',
                entity: 'system',
                name: newSystem.name,
                details: `${req.user.name} created system: ${newSystem.name}`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        console.log(`📝 System created: ${newSystem.name} by ${req.user.email} from IP: ${ip_address}`);

        res.status(201).json({
            success: true,
            message: 'System created successfully',
            data: newSystem
        });

    } catch (error) {
        console.error('Error creating system:', error);
        res.status(500).json({ message: 'Server error' });
    }
};


// Update system with audit log
exports.updateSystem = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        // Get old system data before update
        const oldDataResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM systems WHERE id = @id');

        if (oldDataResult.recordset.length === 0) {
            return res.status(404).json({ message: 'System not found' });
        }

        const oldSystem = oldDataResult.recordset[0];

        const request = pool.request()
            .input('id', sql.Int, id);

        let query = 'UPDATE systems SET ';
        const updates = [];
        const changes = {};

        if (name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
            if (oldSystem.name !== name) {
                changes.name = {
                    old: oldSystem.name,
                    new: name
                };
            }
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

        // Get updated system data
        const newDataResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM systems WHERE id = @id');

        const newSystem = newDataResult.recordset[0];

        // ✅ LOG: System update with IP
        await logAction(
            req,
            'UPDATE',
            'SYSTEM',
            id,
            oldSystem,
            newSystem,
            {
                changes: changes,
                details: `${req.user.name} updated system from "${oldSystem.name}" to "${newSystem.name}"`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        console.log(`📝 System updated: ${oldSystem.name} -> ${newSystem.name} by ${req.user.email} from IP: ${ip_address}`);

        res.json({
            success: true,
            message: 'System updated successfully',
            data: newSystem
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating system' });
    }
};

// Delete system
// Delete system with audit log
exports.deleteSystem = async (req, res) => {
    const { id } = req.params;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        // Get system data before deletion
        const systemResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM systems WHERE id = @id');

        if (systemResult.recordset.length === 0) {
            return res.status(404).json({ message: 'System not found' });
        }

        const systemToDelete = systemResult.recordset[0];

        // ✅ LOG: System deletion with IP
        await logAction(
            req,
            'DELETE',
            'SYSTEM',
            id,
            systemToDelete,
            null,
            {
                deleted: systemToDelete,
                details: `${req.user.name} deleted system: ${systemToDelete.name}`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        // Delete the system
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM systems WHERE id = @id');

        console.log(`📝 System deleted: ${systemToDelete.name} by ${req.user.email} from IP: ${ip_address}`);

        res.json({
            success: true,
            message: 'System deleted successfully',
            deletedSystem: systemToDelete
        });

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
        const result = await pool.request().query('SELECT id, name FROM Departments ORDER BY name');
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.status(500).json({ message: 'Error fetching departments', error: err.message });
    }
};

// Create department with audit log
exports.createDepartment = async (req, res) => {
    try {
        const { name } = req.body;
        const ip_address = getClientIp(req);

        if (!name) {
            return res.status(400).json({ message: 'Department name is required' });
        }

        const pool = await poolPromise;

        const checkResult = await pool.request()
            .input('name', sql.NVarChar, name)
            .query('SELECT id FROM departments WHERE name = @name');

        if (checkResult.recordset.length > 0) {
            return res.status(400).json({ message: 'Department already exists' });
        }

        const result = await pool.request()
            .input('name', sql.NVarChar, name)
            .query(`
                INSERT INTO departments (name, created_at)
                OUTPUT INSERTED.id, INSERTED.name, INSERTED.created_at
                VALUES (@name, GETDATE())
            `);

        const newDepartment = result.recordset[0];

        await logAction(
            req,
            'CREATE',
            'DEPARTMENT',
            newDepartment.id,
            null,
            newDepartment,
            {
                details: `${req.user.name} created department: ${newDepartment.name}`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        res.status(201).json({
            success: true,
            message: 'Department created successfully',
            data: newDepartment
        });

    } catch (error) {
        console.error('Error creating department:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
// Update department with audit log
exports.updateDepartment = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        // Get old department data before update
        const oldDataResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM departments WHERE id = @id');

        if (oldDataResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Department not found' });
        }

        const oldDepartment = oldDataResult.recordset[0];

        const request = pool.request()
            .input('id', sql.Int, id);

        let query = 'UPDATE departments SET ';
        const updates = [];
        const changes = {};

        if (name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
            if (oldDepartment.name !== name) {
                changes.name = {
                    old: oldDepartment.name,
                    new: name
                };
            }
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

        // Get updated department data
        const newDataResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM departments WHERE id = @id');

        const newDepartment = newDataResult.recordset[0];

        // ✅ LOG: Department update with IP
        await logAction(
            req,
            'UPDATE',
            'DEPARTMENT',
            id,
            oldDepartment,
            newDepartment,
            {
                changes: changes,
                details: `${req.user.name} updated department from "${oldDepartment.name}" to "${newDepartment.name}"`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        console.log(`📝 Department updated: ${oldDepartment.name} -> ${newDepartment.name} by ${req.user.email} from IP: ${ip_address}`);

        res.json({
            success: true,
            message: 'Department updated successfully',
            data: newDepartment
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating department' });
    }
};

// Delete department with audit log
exports.deleteDepartment = async (req, res) => {
    const { id } = req.params;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        // Get department data before deletion
        const departmentResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM departments WHERE id = @id');

        if (departmentResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Department not found' });
        }

        const departmentToDelete = departmentResult.recordset[0];

        // Check if department is being used (optional)
        const usageCheck = await pool.request()
            .input('department_name', sql.NVarChar, departmentToDelete.name)
            .query('SELECT COUNT(*) as count FROM tickets WHERE department = @department_name');

        if (usageCheck.recordset[0].count > 0) {
            return res.status(400).json({
                message: `Cannot delete department. It is used in ${usageCheck.recordset[0].count} ticket(s).`
            });
        }

        // ✅ LOG: Department deletion with IP
        await logAction(
            req,
            'DELETE',
            'DEPARTMENT',
            id,
            departmentToDelete,
            null,
            {
                deleted: departmentToDelete,
                details: `${req.user.name} deleted department: ${departmentToDelete.name}`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        // Delete the department
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM departments WHERE id = @id');

        console.log(`📝 Department deleted: ${departmentToDelete.name} by ${req.user.email} from IP: ${ip_address}`);

        res.json({
            success: true,
            message: 'Department deleted successfully',
            deletedDepartment: departmentToDelete
        });

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
        const result = await pool.request().query('SELECT id, name FROM Branches ORDER BY name');
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching branches:', err);
        res.status(500).json({ message: 'Error fetching branches', error: err.message });
    }
};

// Create branch with audit log
exports.createBranch = async (req, res) => {
    try {
        const { name } = req.body;
        const ip_address = getClientIp(req);

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Branch name is required'
            });
        }

        const pool = await poolPromise;

        // Check if branch already exists
        const checkResult = await pool.request()
            .input('name', sql.NVarChar, name)
            .query('SELECT id FROM branches WHERE name = @name');

        if (checkResult.recordset.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Branch already exists'
            });
        }

        // Insert new branch
        const result = await pool.request()
            .input('name', sql.NVarChar, name)
            .query(`
                INSERT INTO branches (name, created_at)
                OUTPUT INSERTED.id, INSERTED.name, INSERTED.created_at
                VALUES (@name, GETDATE())
            `);

        const newBranch = result.recordset[0];

        // ✅ LOG: Branch creation with IP
        await logAction(
            req,
            'CREATE',
            'BRANCH',
            newBranch.id,
            null,
            {
                id: newBranch.id,
                name: newBranch.name,
                created_at: newBranch.created_at
            },
            {
                action: 'create',
                entity: 'branch',
                name: newBranch.name,
                details: `${req.user.name} created branch: ${newBranch.name}`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        console.log(`📝 Branch created: ${newBranch.name} by ${req.user.email} from IP: ${ip_address}`);

        res.status(201).json({
            success: true,
            message: 'Branch created successfully',
            data: newBranch
        });

    } catch (error) {
        console.error('Error creating branch:', error);
        res.status(500).json({
            success: false,
            message: 'Server error',
            error: error.message
        });
    }
};

// Update branch with audit log
exports.updateBranch = async (req, res) => {
    const { id } = req.params;
    const { name, is_active } = req.body;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        const oldDataResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM branches WHERE id = @id');

        if (oldDataResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Branch not found' });
        }

        const oldBranch = oldDataResult.recordset[0];

        const request = pool.request()
            .input('id', sql.Int, id);

        let query = 'UPDATE branches SET ';
        const updates = [];
        const changes = {};

        if (name !== undefined) {
            updates.push('name = @name');
            request.input('name', sql.NVarChar, name);
            if (oldBranch.name !== name) {
                changes.name = {
                    old: oldBranch.name,
                    new: name
                };
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        query += updates.join(', ') + ' WHERE id = @id';
        await request.query(query);

        const newDataResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM branches WHERE id = @id');

        const newBranch = newDataResult.recordset[0];

        await logAction(
            req,
            'UPDATE',
            'BRANCH',
            id,
            oldBranch,
            newBranch,
            {
                changes: changes,
                details: `${req.user.name} updated branch from "${oldBranch.name}" to "${newBranch.name}"`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        res.json({
            success: true,
            message: 'Branch updated successfully',
            data: newBranch
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating branch' });
    }
};

// Delete branch with audit log
exports.deleteBranch = async (req, res) => {
    const { id } = req.params;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        const branchResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT id, name FROM branches WHERE id = @id');

        if (branchResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Branch not found' });
        }

        const branchToDelete = branchResult.recordset[0];

        // Check if branch is being used
        const usageCheck = await pool.request()
            .input('branch_name', sql.NVarChar, branchToDelete.name)
            .query('SELECT COUNT(*) as count FROM tickets WHERE branch = @branch_name');

        if (usageCheck.recordset[0].count > 0) {
            return res.status(400).json({
                message: `Cannot delete branch. It is used in ${usageCheck.recordset[0].count} ticket(s).`
            });
        }

        await logAction(
            req,
            'DELETE',
            'BRANCH',
            id,
            branchToDelete,
            null,
            {
                deleted: branchToDelete,
                details: `${req.user.name} deleted branch: ${branchToDelete.name}`,
                ip: ip_address
            },
            {
                id: req.user.id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role
            }
        );

        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM branches WHERE id = @id');

        res.json({
            success: true,
            message: 'Branch deleted successfully'
        });

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
// Get user's favorite templates
exports.getUserFavorites = async (req, res) => {
    const userId = req.user.id;  // Using user ID, not email
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('userId', sql.Int, userId)  // Changed to userId and Int type
            .query('SELECT template_id FROM UserFavorites WHERE user_id = @userId');

        res.json(result.recordset.map(row => row.template_id));
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching favorites' });
    }
};

// Toggle favorite template
exports.toggleFavorite = async (req, res) => {
    const userId = req.user.id;
    const { templateId } = req.params;

    try {
        const pool = await poolPromise;

        // Check if favorite exists
        const check = await pool.request()
            .input('userId', sql.Int, userId)
            .input('templateId', sql.NVarChar, templateId)
            .query('SELECT 1 FROM UserFavorites WHERE user_id = @userId AND template_id = @templateId');

        if (check.recordset.length > 0) {
            // Delete favorite
            await pool.request()
                .input('userId', sql.Int, userId)
                .input('templateId', sql.NVarChar, templateId)
                .query('DELETE FROM UserFavorites WHERE user_id = @userId AND template_id = @templateId');

            res.json({ message: 'Favorite removed', isFavorite: false });
        } else {
            // Add favorite
            await pool.request()
                .input('userId', sql.Int, userId)
                .input('templateId', sql.NVarChar, templateId)
                .query('INSERT INTO UserFavorites (user_id, template_id) VALUES (@userId, @templateId)');

            res.json({ message: 'Favorite added', isFavorite: true });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error toggling favorite' });
    }
};