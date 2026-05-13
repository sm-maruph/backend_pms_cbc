const { poolPromise, sql } = require('../config/db');

exports.getAllTickets = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                t.*, 
                u.name as reportedByName,
                assigned_user.name as assignedToName
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_email = u.email
            LEFT JOIN Users assigned_user ON t.assigned_to_email = assigned_user.email
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
                SELECT 
                    t.*, 
                    u.name as reportedByName,
                    assigned_user.name as assignedToName
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_email = u.email
                LEFT JOIN Users assigned_user ON t.assigned_to_email = assigned_user.email
                WHERE t.reported_by_email = @email OR t.assigned_to_email = @email
                ORDER BY t.created_at DESC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching my tickets' });
    }
};

exports.createTicket = async (req, res) => {
    console.log("📥 ========== CREATE TICKET REQUEST ==========");
    console.log("📦 Request body:", JSON.stringify(req.body, null, 2));
    console.log("👤 User from token:", req.user);

    const {
        date,
        systemName,
        problemDetails,
        department,
        branch,
        riskLabel,
        affectedUser,
        assignedToEmail,
        assignedToName,
        pcName,
        downTime
    } = req.body;

    // Check for missing required fields
    const missingFields = [];
    if (!systemName) missingFields.push('systemName');
    if (!problemDetails) missingFields.push('problemDetails');
    if (!department) missingFields.push('department');
    if (!branch) missingFields.push('branch');
    if (!affectedUser) missingFields.push('affectedUser');

    if (missingFields.length > 0) {
        console.log("❌ Missing required fields:", missingFields);
        return res.status(400).json({
            message: `Missing required fields: ${missingFields.join(', ')}`,
            received: req.body
        });
    }

    console.log("✅ All required fields present");

    const reportedByEmail = req.user.email;
    const reporterName = req.user.name;

    try {
        const pool = await poolPromise;

        // Convert downTime to SQL compatible format
        let formattedDownTime = null;
        if (downTime) {
            try {
                // Try to parse the date string
                const parsedDate = new Date(downTime);
                if (!isNaN(parsedDate.getTime())) {
                    formattedDownTime = parsedDate;
                } else {
                    formattedDownTime = new Date();
                }
            } catch (e) {
                formattedDownTime = new Date();
            }
        }

        // Generate ticket_sl
        console.log("📝 Generating ticket_sl...");
        const ticketSLResult = await pool.request()
            .input('inputDate', sql.Date, date || new Date())
            .query(`
                DECLARE @date DATE = @inputDate;
                DECLARE @day NVARCHAR(2) = RIGHT('0' + CAST(DAY(@date) AS NVARCHAR(2)), 2);
                DECLARE @monthNum NVARCHAR(2) = RIGHT('0' + CAST(MONTH(@date) AS NVARCHAR(2)), 2);
                DECLARE @year NVARCHAR(4) = CAST(YEAR(@date) AS NVARCHAR(4));
                DECLARE @datePart NVARCHAR(8) = @day + @monthNum + @year;
                DECLARE @sequence INT;
                
                SELECT @sequence = ISNULL(MAX(CAST(SUBSTRING(ticket_sl, CHARINDEX('-', ticket_sl) + 1, LEN(ticket_sl)) AS INT)), 0) + 1
                FROM Tickets
                WHERE ticket_sl IS NOT NULL AND ticket_sl LIKE @datePart + '-%';
                
                IF @sequence IS NULL SET @sequence = 1;
                
                SELECT @datePart + '-' + CAST(@sequence AS NVARCHAR(10)) AS ticket_sl;
            `);

        const ticket_sl = ticketSLResult.recordset[0]?.ticket_sl;
        console.log("✅ Generated ticket_sl:", ticket_sl);

        // Use values from frontend
        const finalAssignedToEmail = assignedToEmail || null;
        const finalAssignedToName = assignedToName || 'Unassigned';

        console.log("📝 Inserting ticket...");
        await pool.request()
            .input('ticket_sl', sql.NVarChar, ticket_sl)
            .input('date', sql.Date, date || new Date())
            .input('month', sql.NVarChar, new Date(date || new Date()).toLocaleString('default', { month: 'long' }))
            .input('systemName', sql.NVarChar, systemName)
            .input('problemDetails', sql.NVarChar, problemDetails)
            .input('department', sql.NVarChar, department)
            .input('branch', sql.NVarChar, branch)
            .input('riskLabel', sql.NVarChar, riskLabel || 'MEDIUM')
            .input('affectedUser', sql.NVarChar, affectedUser)
            .input('assignedToEmail', sql.NVarChar, finalAssignedToEmail)
            .input('assignedToName', sql.NVarChar, finalAssignedToName)
            .input('pcName', sql.NVarChar, pcName || null)
            .input('downTime', sql.DateTime, formattedDownTime || new Date())
            .input('reportedByEmail', sql.NVarChar, reportedByEmail)
            .input('reporterName', sql.NVarChar, reporterName)
            .query(`
                INSERT INTO Tickets (
                    ticket_sl, date, month, system_name, problem_details, 
                    department, branch, risk_label, affected_user, 
                    assigned_to_email, assigned_to_name, pc_name, down_time, 
                    reported_by_email, reporter_name, status, created_at, updated_at
                )
                VALUES (
                    @ticket_sl, @date, @month, @systemName, @problemDetails,
                    @department, @branch, @riskLabel, @affectedUser,
                    @assignedToEmail, @assignedToName, @pcName, @downTime,
                    @reportedByEmail, @reporterName, 'open', GETDATE(), GETDATE()
                )
            `);

        console.log("✅ Ticket inserted successfully:", ticket_sl);

        res.status(201).json({
            message: 'Ticket created successfully',
            ticket_sl: ticket_sl,
            ticketId: ticket_sl
        });

    } catch (err) {
        console.error('❌ Error creating ticket:', err);
        console.error('❌ Error stack:', err.stack);
        res.status(500).json({ message: 'Error creating ticket', error: err.message });
    }
};
exports.updateTicket = async (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    console.log("📥 Update request for ticket:", id);
    console.log("📦 Update data:", updates);

    // Update allowed fields to include new schema fields
    const allowed = [
        'status', 'assigned_to_name', 'assigned_to_email', 'up_time',
        'root_cause', 'resolution', 'remarks', 'remarks_by_admin',
        'risk_label', 'system_name', 'department', 'branch',
        'affected_user', 'pc_name', 'down_time', 'problem_details'
    ];

    const setClause = [];
    const pool = await poolPromise;
    const request = pool.request();
    request.input('id', sql.Int, id);

    for (let field of allowed) {
        if (updates[field] !== undefined) {
            // Handle date fields specially
            if (field === 'up_time' || field === 'down_time') {
                let dateValue = updates[field];
                if (dateValue) {
                    // Try to convert to valid Date object
                    const parsedDate = new Date(dateValue);
                    if (!isNaN(parsedDate.getTime())) {
                        dateValue = parsedDate;
                    } else {
                        dateValue = null;
                    }
                }
                setClause.push(`${field} = @${field}`);
                request.input(field, sql.DateTime, dateValue || null);
            } else {
                setClause.push(`${field} = @${field}`);
                request.input(field, sql.NVarChar, updates[field]);
            }
        }
    }

    // If assigned_to_email is updated, also update assigned_to_name
    if (updates.assigned_to_email) {
        const userResult = await pool.request()
            .input('email', sql.NVarChar, updates.assigned_to_email)
            .query('SELECT name FROM Users WHERE email = @email');

        if (userResult.recordset[0]) {
            request.input('assigned_to_name', sql.NVarChar, userResult.recordset[0].name);
            setClause.push('assigned_to_name = @assigned_to_name');
        }
    }

    // Handle resolved status with proper date
    if (updates.status === 'resolved' && !updates.up_time) {
        const now = new Date();
        request.input('up_time', sql.DateTime, now);
        setClause.push('up_time = @up_time');
        console.log("🕐 Setting up_time to:", now);
    }

    if (setClause.length === 0) {
        return res.status(400).json({ message: 'No valid fields to update' });
    }

    setClause.push('updated_at = GETDATE()');

    try {
        const query = `UPDATE Tickets SET ${setClause.join(', ')} WHERE id = @id`;
        console.log("📝 Update query:", query);
        await request.query(query);
        res.json({ message: 'Ticket updated successfully' });
    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ message: 'Update failed', error: err.message });
    }
};

exports.deleteTicket = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await poolPromise;
        await pool.request().input('id', sql.Int, id).query('DELETE FROM Tickets WHERE id = @id');
        res.json({ message: 'Ticket deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Delete failed' });
    }
};

// Additional helper function to get ticket by ticket_sl
exports.getTicketBySL = async (req, res) => {
    const { ticket_sl } = req.params;
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('ticket_sl', sql.NVarChar, ticket_sl)
            .query(`
                SELECT 
                    t.*, 
                    u.name as reportedByName,
                    assigned_user.name as assignedToName
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_email = u.email
                LEFT JOIN Users assigned_user ON t.assigned_to_email = assigned_user.email
                WHERE t.ticket_sl = @ticket_sl
            `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ message: 'Ticket not found' });
        }

        res.json(result.recordset[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching ticket' });
    }
};