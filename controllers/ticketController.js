const { poolPromise, sql } = require('../config/db');

exports.getAllTickets = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT t.*, u.name as reportedByName
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_email = u.email
            ORDER BY t.created_at DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching tickets' });
    }
};

exports.getMyTickets = async (req, res) => {
    const userEmail = req.user.email;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('email', sql.NVarChar, userEmail)
            .query(`
                SELECT t.*, u.name as reportedByName
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_email = u.email
                WHERE t.reported_by_email = @email
                ORDER BY t.created_at DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching my tickets' });
    }
};

exports.createTicket = async (req, res) => {
    const { date, systemName, problemDetails, department, branch, riskLabel, affectedUser, assignedToEmail, pcName, downTime } = req.body;
    const reportedByEmail = req.user.email;
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('date', sql.Date, date || new Date())
            .input('systemName', sql.NVarChar, systemName)
            .input('problemDetails', sql.NVarChar, problemDetails)
            .input('department', sql.NVarChar, department)
            .input('branch', sql.NVarChar, branch)
            .input('riskLabel', sql.NVarChar, riskLabel)
            .input('affectedUser', sql.NVarChar, affectedUser)
            .input('assignedToEmail', sql.NVarChar, assignedToEmail || null)
            .input('pcName', sql.NVarChar, pcName || null)
            .input('downTime', sql.DateTime, downTime || new Date())
            .input('reportedByEmail', sql.NVarChar, reportedByEmail)
            .query(`
                INSERT INTO Tickets (date, system_name, problem_details, department, branch, risk_label, affected_user, assigned_to_name, pc_name, down_time, reported_by_email, status, month, created_at)
                VALUES (@date, @systemName, @problemDetails, @department, @branch, @riskLabel, @affectedUser, @assignedToEmail, @pcName, @downTime, @reportedByEmail, 'open', FORMAT(@date, 'MMMM'), GETDATE())
            `);
        res.status(201).json({ message: 'Ticket created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error creating ticket' });
    }
};

exports.updateTicket = async (req, res) => {
    const { id } = req.params;
    const updates = req.body;
    const allowed = ['status', 'assigned_to_name', 'up_time', 'root_cause', 'resolution', 'remarks', 'remarks_by_admin'];
    const setClause = [];
    const request = (await poolPromise).request();
    request.input('id', sql.Int, id);

    for (let field of allowed) {
        if (updates[field] !== undefined) {
            setClause.push(`${field} = @${field}`);
            request.input(field, sql.NVarChar, updates[field]);
        }
    }
    if (updates.status === 'resolved' && !updates.up_time) {
        request.input('up_time', sql.DateTime, new Date());
        setClause.push('up_time = @up_time');
    }
    if (setClause.length === 0) return res.status(400).json({ message: 'No valid fields to update' });
    setClause.push('updated_at = GETDATE()');

    try {
        await request.query(`UPDATE Tickets SET ${setClause.join(', ')} WHERE id = @id`);
        res.json({ message: 'Ticket updated' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Update failed' });
    }
};

exports.deleteTicket = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Tickets WHERE id = @id');
        res.json({ message: 'Ticket deleted' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Delete failed' });
    }
};