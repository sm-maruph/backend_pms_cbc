const { poolPromise, sql } = require('../config/db');
const { saveNotification } = require('./notificationController');

// Helper to get ALL users (both admin and regular users)
async function getAllUsers() {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT email, name, role FROM Users");
    return result.recordset;
}


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


// ============================================
// GET PAGINATED TICKETS (For table with filters)
// ============================================
exports.getPaginatedTickets = async (req, res) => {
    try {
        const pool = await poolPromise;

        const page = parseInt(req.query.page) || 1;
        const pageSize = parseInt(req.query.pageSize) || 50;
        const offset = (page - 1) * pageSize;

        const status = req.query.status || 'all';
        const search = req.query.search || '';
        const dateFilter = req.query.dateFilter || 'all';
        const sortBy = req.query.sortBy || 'date';

        console.log('📊 Fetching tickets with filters:', { page, pageSize, status, search, dateFilter, sortBy });

        // Build WHERE clause
        let whereClause = 'WHERE 1=1';
        const params = {};

        // Status filter
        if (status !== 'all') {
            whereClause += ' AND t.status = @status';
            params.status = status;
        }

        // Search filter
        if (search) {
            whereClause += ` AND (
                t.system_name LIKE @search OR 
                t.problem_details LIKE @search OR 
                t.affected_user LIKE @search OR
                u.name LIKE @search OR
                t.ticket_sl LIKE @search
            )`;
            params.search = `%${search}%`;
        }

        // Date filter - Using same logic as frontend (based on date field)
        if (dateFilter !== 'all') {
            const dateRange = getDateRangeForFilter(dateFilter);
            console.log('🔍 DATE FILTER DEBUG:');
            console.log('  - Filter type:', dateFilter);
            console.log('  - Start date:', dateRange.startDate);
            console.log('  - End date:', dateRange.endDate);

            if (dateRange.startDate && dateRange.endDate) {
                whereClause += ' AND t.date >= @startDate AND t.date <= @endDate';
                params.startDate = dateRange.startDate;
                params.endDate = dateRange.endDate;
                console.log('  - WHERE clause added with date range');
            } else {
                console.log('  - No date range applied - check getDateRangeForFilter');
            }
        } else {
            console.log('  - Date filter is "all" - no date filter applied');
        }

        // Build ORDER BY
        let orderBy = '';
        switch (sortBy) {
            case 'date':
                orderBy = 'ORDER BY t.created_at DESC';
                break;
            case 'status':
                orderBy = 'ORDER BY t.status';
                break;
            case 'risk':
                orderBy = `ORDER BY 
                    CASE t.risk_label 
                        WHEN 'HIGH' THEN 3 
                        WHEN 'MEDIUM' THEN 2 
                        WHEN 'LOW' THEN 1 
                        ELSE 0 
                    END DESC`;
                break;
            default:
                orderBy = 'ORDER BY t.created_at DESC';
        }

        // Get total count
        const countRequest = pool.request();
        // ✅ ADD THIS - Add parameters to countRequest
        if (params.status) {
            countRequest.input('status', sql.NVarChar, params.status);
        }
        if (params.search) {
            countRequest.input('search', sql.NVarChar, params.search);
        }
        if (params.startDate) {
            countRequest.input('startDate', sql.Date, params.startDate);
        }
        if (params.endDate) {
            countRequest.input('endDate', sql.Date, params.endDate);
        }
        const countResult = await countRequest.query(`
            SELECT COUNT(*) as total
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_email = u.email
            ${whereClause}
        `);

        const totalCount = countResult.recordset[0].total;

        // Get paginated data
        const dataRequest = pool.request();
        for (const [key, value] of Object.entries(params)) {
            if (key === 'startDate' || key === 'endDate') {
                dataRequest.input(key, sql.Date, value);
            } else {
                dataRequest.input(key, sql.NVarChar, value);
            }
        }
        dataRequest.input('offset', sql.Int, offset);
        dataRequest.input('pageSize', sql.Int, pageSize);

        const result = await dataRequest.query(`
            SELECT 
                t.*, 
                u.name as reportedByName,
                assigned_user.name as assignedToName
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_email = u.email
            LEFT JOIN Users assigned_user ON t.assigned_to_email = assigned_user.email
            ${whereClause}
            ${orderBy}
            OFFSET @offset ROWS
            FETCH NEXT @pageSize ROWS ONLY
        `);

        res.json({
            tickets: result.recordset,
            pagination: {
                currentPage: page,
                pageSize: pageSize,
                totalCount: totalCount,
                totalPages: Math.ceil(totalCount / pageSize),
                hasNext: page < Math.ceil(totalCount / pageSize),
                hasPrev: page > 1
            }
        });

    } catch (err) {
        console.error('Error fetching paginated tickets:', err);
        res.status(500).json({ message: 'Error fetching tickets', error: err.message });
    }
};

// ============================================
// GET DASHBOARD STATS (For charts and cards)
// ============================================
exports.getDashboardStats = async (req, res) => {
    try {
        const pool = await poolPromise;
        const { dateFilter = 'all' } = req.query;

        console.log('📊 Fetching dashboard stats with filter:', dateFilter);

        // Build WHERE clause using same date logic
        let whereClause = 'WHERE 1=1';
        const params = {};

        // Date filter - Using same logic as frontend
        if (dateFilter !== 'all') {
            const dateRange = getDateRangeForFilter(dateFilter);
            console.log('🔍 Date range:', dateRange);

            if (dateRange.startDate && dateRange.endDate) {
                whereClause += ' AND t.date >= @startDate AND t.date <= @endDate';
                params.startDate = dateRange.startDate;
                params.endDate = dateRange.endDate;
                console.log('✅ WHERE clause added with date range');
                console.log('✅ Params:', params);
            }
        }

        // Create request and add parameters
        const statsRequest = pool.request();

        // ✅ IMPORTANT: Add parameters to the request
        if (params.startDate) {
            statsRequest.input('startDate', sql.Date, params.startDate);
        }
        if (params.endDate) {
            statsRequest.input('endDate', sql.Date, params.endDate);
        }

        console.log('📝 Final WHERE clause:', whereClause);

        const result = await statsRequest.query(`
            SELECT 
                COUNT(*) as total_tickets,
                SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) as open_count,
                SUM(CASE WHEN t.status = 'in-progress' THEN 1 ELSE 0 END) as in_progress_count,
                SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
                SUM(CASE WHEN t.status != 'resolved' THEN 1 ELSE 0 END) as active_tickets,
                SUM(CASE WHEN t.status != 'resolved' AND t.risk_label = 'HIGH' THEN 1 ELSE 0 END) as high_risk_count,
                SUM(CASE WHEN t.status != 'resolved' AND t.risk_label = 'MEDIUM' THEN 1 ELSE 0 END) as medium_risk_count,
                SUM(CASE WHEN t.status != 'resolved' AND t.risk_label = 'LOW' THEN 1 ELSE 0 END) as low_risk_count
            FROM Tickets t
            ${whereClause}
        `);

        const stats = result.recordset[0];

        console.log('📊 Stats result:', {
            total: stats.total_tickets,
            open: stats.open_count,
            inProgress: stats.in_progress_count,
            resolved: stats.resolved_count,
            dateFilter: dateFilter
        });

        // Prepare chart data
        const statusChartData = [
            { name: "Open", value: stats.open_count || 0, color: "#ef4444" },
            { name: "In Progress", value: stats.in_progress_count || 0, color: "#eab308" },
            { name: "Resolved", value: stats.resolved_count || 0, color: "#22c55e" }
        ].filter(item => item.value > 0);

        const riskChartData = [
            { name: "Low Risk", value: stats.low_risk_count || 0, color: "#3b82f6" },
            { name: "Medium Risk", value: stats.medium_risk_count || 0, color: "#f97316" },
            { name: "High Risk", value: stats.high_risk_count || 0, color: "#ef4444" }
        ].filter(item => item.value > 0);

        res.json({
            stats: {
                total: stats.total_tickets || 0,
                open: stats.open_count || 0,
                progress: stats.in_progress_count || 0,
                resolved: stats.resolved_count || 0,
                activeTotal: stats.active_tickets || 0,
                highRisk: stats.high_risk_count || 0,
                mediumRisk: stats.medium_risk_count || 0,
                lowRisk: stats.low_risk_count || 0
            },
            statusChartData,
            riskChartData
        });

    } catch (err) {
        console.error('Error fetching dashboard stats:', err);
        res.status(500).json({ message: 'Error fetching stats', error: err.message });
    }
};
// ============================================
// HELPER: Get date range for filter (Matches frontend logic)
// ============================================
// ============================================
// HELPER: Get date range for filter (Matches frontend logic exactly)
// ============================================
function getDateRangeForFilter(dateFilter) {
    const now = new Date();
    let startDate = null;
    let endDate = null;

    // Helper to set time to start of day (12:00 AM)
    const startOfDay = (date) => {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    };

    // Helper to set time to end of day (11:59:59 PM)
    const endOfDay = (date) => {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
    };

    switch (dateFilter) {
        case 'today': {
            // Today from 12:00 AM to 11:59 PM
            startDate = startOfDay(now);
            endDate = endOfDay(now);
            break;
        }
        case 'yesterday': {
            // Yesterday from 12:00 AM to 11:59 PM
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            startDate = startOfDay(yesterday);
            endDate = endOfDay(yesterday);
            break;
        }
        case 'week': {
            // Current week (Sunday to Saturday)
            const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - currentDay); // Go back to Sunday
            startDate = startOfDay(startOfWeek);

            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6); // Go to Saturday
            endDate = endOfDay(endOfWeek);
            break;
        }
        case 'month': {
            // FULL CURRENT MONTH (1st to last day of the month)
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            startDate = startOfDay(startOfMonth);

            const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            endDate = endOfDay(endOfMonth);
            break;
        }
        case 'quarter': {
            // FULL CURRENT QUARTER (quarter start to quarter end)
            const quarter = Math.floor(now.getMonth() / 3);
            const startMonth = quarter * 3;
            const startOfQuarter = new Date(now.getFullYear(), startMonth, 1);
            startDate = startOfDay(startOfQuarter);

            const endOfQuarter = new Date(now.getFullYear(), startMonth + 3, 0);
            endDate = endOfDay(endOfQuarter);
            break;
        }
        case 'year': {
            // FULL CURRENT YEAR (Jan 1 to Dec 31)
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            startDate = startOfDay(startOfYear);

            const endOfYear = new Date(now.getFullYear(), 11, 31);
            endDate = endOfDay(endOfYear);
            break;
        }
        default:
            return { startDate: null, endDate: null };
    }

    // Format for SQL Server (YYYY-MM-DD)
    const formatDateForSQL = (date) => {
        if (!date) return null;
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const formattedStartDate = formatDateForSQL(startDate);
    const formattedEndDate = formatDateForSQL(endDate);

    console.log(`📅 Date filter '${dateFilter}' -> start: ${formattedStartDate}, end: ${formattedEndDate}`);

    return { startDate: formattedStartDate, endDate: formattedEndDate };
}
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

        // ============================================================
        // 🔔 SEND NOTIFICATIONS TO ALL USERS
        // ============================================================
        const getAllUsers = async () => {
            const result = await pool.request().query("SELECT email, name, role FROM Users");
            return result.recordset;
        };

        const saveNotification = async (userEmail, notification, ticket_sl = null, metadata = null) => {
            try {
                await pool.request()
                    .input('user_email', sql.NVarChar, userEmail)
                    .input('type', sql.NVarChar, notification.type)
                    .input('title', sql.NVarChar, notification.title)
                    .input('message', sql.NVarChar, notification.message)
                    .input('ticket_sl', sql.NVarChar, ticket_sl)
                    .input('metadata', sql.NVarChar, metadata ? JSON.stringify(metadata) : null)
                    .query(`
                        INSERT INTO Notifications (user_email, type, title, message, ticket_sl, metadata, created_at)
                        VALUES (@user_email, @type, @title, @message, @ticket_sl, @metadata, GETDATE())
                    `);
                return true;
            } catch (err) {
                console.error('Failed to save notification:', err);
                return false;
            }
        };

        const allUsers = await getAllUsers();
        console.log(`📢 Sending notifications to ${allUsers.length} users...`);

        const riskEmoji = riskLabel === 'HIGH' ? '🔴' : riskLabel === 'MEDIUM' ? '🟡' : '🟢';
        const notification = {
            type: 'new_ticket',
            title: '📢 New Ticket Created',
            message: `${reporterName} created ticket ${ticket_sl}: ${systemName} ${riskEmoji}`,
        };

        const io = req.app.get('io');
        const connectedUsers = req.app.get('connectedUsers');

        for (const user of allUsers) {
            if (user.email === reportedByEmail) continue;
            await saveNotification(user.email, notification, ticket_sl);
            const socketId = connectedUsers?.get(user.email);
            if (socketId && io) {
                io.to(socketId).emit('notification', {
                    ...notification,
                    id: ticket_sl,
                    created_at: new Date().toISOString(),
                    is_read: 0
                });
                console.log(`✅ Real-time notification sent to ${user.email}`);
            }
        }

        // ============================================================
        // 🚀 EMIT REAL-TIME TICKET UPDATES (ADD THIS SECTION)
        // ============================================================
        if (io) {
            // Emit to all connected clients that a new ticket was created
            io.emit('ticket-created', {
                ticket: {
                    ticket_sl: ticket_sl,
                    systemName: systemName,
                    reporterName: reporterName,
                    status: 'open',
                    riskLevel: riskLabel,
                    createdAt: new Date()
                },
                message: `New ticket ${ticket_sl} created by ${reporterName}`
            });
            console.log('📡 Emitted ticket-created event to all clients');

            // Also emit stats update
            io.emit('stats-updated', {
                reason: 'new_ticket',
                timestamp: new Date()
            });
            console.log('📡 Emitted stats-updated event to all clients');
        }

        console.log(`✅ Notifications sent to all ${allUsers.length} users`);
        console.log("✅ Ticket creation completed successfully!");

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
    console.log("👤 Updated by:", req.user?.email);

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

    // FIRST: Get the old ticket data for comparison and notifications
    const oldTicketResult = await pool.request()
        .input('id', sql.Int, id)
        .query(`
            SELECT 
                t.*, 
                u.name as reportedByName,
                assigned_user.name as assignedToName
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_email = u.email
            LEFT JOIN Users assigned_user ON t.assigned_to_email = assigned_user.email
            WHERE t.id = @id
        `);

    const oldTicket = oldTicketResult.recordset[0];

    if (!oldTicket) {
        return res.status(404).json({ message: 'Ticket not found' });
    }

    console.log("📋 Old ticket data:", {
        id: oldTicket.id,
        ticket_sl: oldTicket.ticket_sl,
        status: oldTicket.status,
        assigned_to_email: oldTicket.assigned_to_email,
        risk_label: oldTicket.risk_label
    });

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
    let newAssigneeName = null;
    if (updates.assigned_to_email) {
        const userResult = await pool.request()
            .input('email', sql.NVarChar, updates.assigned_to_email)
            .query('SELECT name FROM Users WHERE email = @email');

        if (userResult.recordset[0]) {
            newAssigneeName = userResult.recordset[0].name;
            request.input('assigned_to_name', sql.NVarChar, newAssigneeName);
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

        // ============================================================
        // FETCH UPDATED TICKET DATA
        // ============================================================
        const updatedTicketResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT 
                    t.*, 
                    u.name as reportedByName,
                    assigned_user.name as assignedToName
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_email = u.email
                LEFT JOIN Users assigned_user ON t.assigned_to_email = assigned_user.email
                WHERE t.id = @id
            `);

        const updatedTicket = updatedTicketResult.recordset[0];

        // ============================================================
        // SEND NOTIFICATIONS FOR CHANGES
        // ============================================================
        const io = req.app.get('io');
        const connectedUsers = req.app.get('connectedUsers');

        // Helper function to save notification
        const saveNotification = async (userEmail, notification, ticket_sl = null, metadata = null) => {
            try {
                await pool.request()
                    .input('user_email', sql.NVarChar, userEmail)
                    .input('type', sql.NVarChar, notification.type)
                    .input('title', sql.NVarChar, notification.title)
                    .input('message', sql.NVarChar, notification.message)
                    .input('ticket_sl', sql.NVarChar, ticket_sl)
                    .input('metadata', sql.NVarChar, metadata ? JSON.stringify(metadata) : null)
                    .query(`
                        INSERT INTO Notifications (user_email, type, title, message, ticket_sl, metadata, created_at)
                        VALUES (@user_email, @type, @title, @message, @ticket_sl, @metadata, GETDATE())
                    `);
                return true;
            } catch (err) {
                console.error('Failed to save notification:', err);
                return false;
            }
        };

        const updatedBy = req.user?.name || req.user?.email || 'System';

        // 1. STATUS CHANGE NOTIFICATION
        if (updates.status && oldTicket.status !== updates.status) {
            const statusMessages = {
                'open': 'reopened',
                'in-progress': 'started working on',
                'resolved': 'resolved'
            };

            const action = statusMessages[updates.status] || `changed status to ${updates.status}`;
            const statusNotification = {
                type: 'status_change',
                title: `📝 Ticket Status Changed`,
                message: `${updatedBy} ${action} ticket ${oldTicket.ticket_sl}`
            };

            // Notify reporter and assignee
            const usersToNotify = [oldTicket.reported_by_email];
            if (oldTicket.assigned_to_email && oldTicket.assigned_to_email !== oldTicket.reported_by_email) {
                usersToNotify.push(oldTicket.assigned_to_email);
            }

            for (const userEmail of usersToNotify) {
                if (userEmail && userEmail !== req.user?.email) {
                    await saveNotification(userEmail, statusNotification, oldTicket.ticket_sl, {
                        oldStatus: oldTicket.status,
                        newStatus: updates.status,
                        updatedBy: updatedBy
                    });

                    const socketId = connectedUsers?.get(userEmail);
                    if (socketId && io) {
                        io.to(socketId).emit('notification', {
                            ...statusNotification,
                            id: oldTicket.ticket_sl,
                            created_at: new Date().toISOString(),
                            is_read: 0,
                            ticket_sl: oldTicket.ticket_sl
                        });
                    }
                }
            }
        }

        // 2. ASSIGNMENT CHANGE NOTIFICATION
        if (updates.assigned_to_email && oldTicket.assigned_to_email !== updates.assigned_to_email) {
            const assignmentNotification = {
                type: 'assignment',
                title: `📌 Ticket Assigned`,
                message: `${updatedBy} assigned ticket ${oldTicket.ticket_sl} to ${newAssigneeName || updates.assigned_to_email}`
            };

            // Notify new assignee
            await saveNotification(updates.assigned_to_email, assignmentNotification, oldTicket.ticket_sl, {
                assignedBy: updatedBy,
                ticketTitle: oldTicket.system_name
            });

            const newAssigneeSocketId = connectedUsers?.get(updates.assigned_to_email);
            if (newAssigneeSocketId && io) {
                io.to(newAssigneeSocketId).emit('notification', {
                    ...assignmentNotification,
                    id: oldTicket.ticket_sl,
                    created_at: new Date().toISOString(),
                    is_read: 0,
                    ticket_sl: oldTicket.ticket_sl
                });
            }

            // Also notify reporter that ticket was assigned
            if (oldTicket.reported_by_email && oldTicket.reported_by_email !== updates.assigned_to_email) {
                const reporterNotification = {
                    type: 'assignment_update',
                    title: `📌 Ticket Assignment Update`,
                    message: `Ticket ${oldTicket.ticket_sl} has been assigned to ${newAssigneeName || updates.assigned_to_email}`
                };

                await saveNotification(oldTicket.reported_by_email, reporterNotification, oldTicket.ticket_sl);

                const reporterSocketId = connectedUsers?.get(oldTicket.reported_by_email);
                if (reporterSocketId && io) {
                    io.to(reporterSocketId).emit('notification', reporterNotification);
                }
            }
        }

        // 3. RISK LEVEL CHANGE NOTIFICATION
        if (updates.risk_label && oldTicket.risk_label !== updates.risk_label) {
            const riskNotification = {
                type: 'risk_change',
                title: `⚠️ Risk Level Changed`,
                message: `${updatedBy} changed risk level of ticket ${oldTicket.ticket_sl} from ${oldTicket.risk_label} to ${updates.risk_label}`
            };

            const usersToNotify = [oldTicket.reported_by_email];
            if (oldTicket.assigned_to_email && oldTicket.assigned_to_email !== oldTicket.reported_by_email) {
                usersToNotify.push(oldTicket.assigned_to_email);
            }

            for (const userEmail of usersToNotify) {
                if (userEmail && userEmail !== req.user?.email) {
                    await saveNotification(userEmail, riskNotification, oldTicket.ticket_sl);

                    const socketId = connectedUsers?.get(userEmail);
                    if (socketId && io) {
                        io.to(socketId).emit('notification', riskNotification);
                    }
                }
            }
        }

        // ============================================================
        // EMIT REAL-TIME SOCKET EVENTS
        // ============================================================

        if (io) {
            // Emit to all clients that a ticket was updated
            io.emit('ticket-updated', {
                ticket: updatedTicket,
                changes: updates,
                oldData: {
                    status: oldTicket.status,
                    assigned_to_email: oldTicket.assigned_to_email,
                    risk_label: oldTicket.risk_label
                },
                updatedBy: updatedBy,
                timestamp: new Date()
            });
            console.log('📡 Emitted ticket-updated event to all clients');

            // Emit to specific ticket room (for users viewing this ticket)
            io.to(`ticket_${id}`).emit('ticket-detail-updated', {
                ticket: updatedTicket,
                changes: updates,
                updatedBy: updatedBy,
                timestamp: new Date()
            });
            console.log(`📡 Emitted ticket-detail-updated to room ticket_${id}`);

            // Emit stats update if status or risk changed
            if (updates.status || updates.risk_label) {
                io.emit('stats-updated', {
                    reason: 'ticket_updated',
                    ticketId: updatedTicket.ticket_sl,
                    changes: {
                        status: updates.status,
                        risk: updates.risk_label
                    },
                    timestamp: new Date()
                });
                console.log('📡 Emitted stats-updated event to all clients');
            }

            // Emit specific event for status changes
            if (updates.status && oldTicket.status !== updates.status) {
                io.emit('ticket-status-changed', {
                    ticketId: updatedTicket.ticket_sl,
                    ticketSl: oldTicket.ticket_sl,
                    oldStatus: oldTicket.status,
                    newStatus: updates.status,
                    updatedBy: updatedBy,
                    timestamp: new Date()
                });
                console.log(`📡 Emitted ticket-status-changed: ${oldTicket.status} -> ${updates.status}`);
            }

            // Emit specific event for assignment changes
            if (updates.assigned_to_email && oldTicket.assigned_to_email !== updates.assigned_to_email) {
                io.emit('ticket-assigned', {
                    ticketId: updatedTicket.ticket_sl,
                    ticketSl: oldTicket.ticket_sl,
                    oldAssignee: oldTicket.assigned_to_email,
                    newAssignee: updates.assigned_to_email,
                    newAssigneeName: newAssigneeName,
                    assignedBy: updatedBy,
                    timestamp: new Date()
                });
                console.log(`📡 Emitted ticket-assigned: ${oldTicket.assigned_to_email} -> ${updates.assigned_to_email}`);
            }
        }

        console.log("✅ Ticket updated successfully:", oldTicket.ticket_sl);
        res.json({
            message: 'Ticket updated successfully',
            ticket: updatedTicket,
            changes: updates
        });

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

// Open: backend/controllers/ticketController.js
// Add this function at the end of the file (before module.exports)

// ============================================
// VALIDATE BULK TICKETS (Check before import)
// ============================================
// ============================================
// VALIDATE BULK TICKETS (Updated - only checks essential fields)
// ============================================
exports.validateBulkTickets = async (req, res) => {
    console.log("🔍 ========== VALIDATE BULK TICKETS ==========");

    const tickets = req.body;
    const validationResults = {
        valid: [],
        invalid: [],
        summary: {
            total: tickets.length,
            validCount: 0,
            invalidCount: 0,
            missingRequiredFields: []
        }
    };

    // Only problem_details is truly required (like createTicket)
    const requiredFields = ['problem_details'];

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const errors = [];

        const isEmpty = (value) => {
            return value === undefined || value === null || value === '' ||
                String(value).trim() === '' || String(value).trim() === 'NaN';
        };

        // Check only essential required fields
        for (const field of requiredFields) {
            if (isEmpty(ticket[field])) {
                errors.push(`${field} is required`);
            }
        }

        if (errors.length > 0) {
            validationResults.invalid.push({
                row: i + 1,
                ticket_sl: ticket.ticket_sl || 'N/A',
                reporter: ticket.reporter_name || 'Unknown',
                errors: errors
            });
            validationResults.summary.invalidCount++;
        } else {
            validationResults.valid.push({
                row: i + 1,
                ticket_sl: ticket.ticket_sl || 'will be auto-generated',
                reporter: ticket.reporter_name || 'Will use admin',
                system: ticket.system_name || 'Not Specified'
            });
            validationResults.summary.validCount++;
        }
    }

    console.log(`📊 Validation: ${validationResults.summary.validCount} valid, ${validationResults.summary.invalidCount} invalid`);

    res.status(200).json(validationResults);
};

// ============================================
// BULK IMPORT TICKETS (Updated - Fetches emails from Users table)
// ============================================
exports.bulkImportTickets = async (req, res) => {
    console.log("📥 ========== BULK IMPORT TICKETS REQUEST ==========");
    console.log("📦 Number of tickets:", req.body.length);
    console.log("👤 User from token:", req.user);

    const tickets = req.body;
    const results = {
        successful: [],
        failed: [],
        total: tickets.length
    };

    const pool = await poolPromise;

    // Get the logged-in user's info (admin doing the import)
    const adminEmail = req.user.email;
    const adminName = req.user.name;

    // Helper function to handle empty values - returns NULL for database
    const handleEmptyValue = (value) => {
        if (value === undefined || value === null || value === '') {
            return null;
        }
        const stringValue = String(value).trim();
        if (stringValue === '' || stringValue === 'NaN' || stringValue === 'null' || stringValue === 'undefined') {
            return null;
        }
        return stringValue;
    };

    // Helper function for string fields - returns default instead of NULL
    const handleStringField = (value, defaultValue) => {
        if (value === undefined || value === null || value === '') {
            return defaultValue;
        }
        const stringValue = String(value).trim();
        if (stringValue === '' || stringValue === 'NaN' || stringValue === 'null' || stringValue === 'undefined') {
            return defaultValue;
        }
        return stringValue;
    };

    // Helper function to get email from Users table by name
    const getUserEmailByName = async (name, pool) => {
        if (!name || name === 'Unassigned' || name === 'Not Mentioned') {
            return null;
        }
        try {
            const result = await pool.request()
                .input('name', sql.NVarChar, name)
                .query('SELECT email FROM Users WHERE name = @name');

            if (result.recordset.length > 0) {
                return result.recordset[0].email;
            }
            console.log(`⚠️ User not found: ${name}`);
            return null;
        } catch (err) {
            console.error(`❌ Error fetching email for ${name}:`, err.message);
            return null;
        }
    };

    // Helper function to validate and get ID from static tables
    const getStaticItemId = async (pool, tableName, columnName, value) => {
        if (!value || value === 'Not Specified') return null;

        try {
            const result = await pool.request()
                .input('name', sql.NVarChar, value)
                .query(`SELECT id FROM ${tableName} WHERE ${columnName} = @name`);

            if (result.recordset.length > 0) {
                return result.recordset[0].id;
            }
            return null;
        } catch (err) {
            console.error(`❌ Error checking ${tableName}:`, err.message);
            return null;
        }
    };

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];

        try {
            console.log(`\n📝 Processing ticket ${i + 1}/${tickets.length}:`, ticket.ticket_sl || `row_${i + 1}`);

            // Extract values with proper handling
            const providedTicketSl = handleEmptyValue(ticket.ticket_sl);
            const date = handleEmptyValue(ticket.date);
            const month = handleEmptyValue(ticket.month);
            const affected_user = handleStringField(ticket.affected_user, 'Not Mentioned');
            const assigned_to_name = handleStringField(ticket.assigned_to_name, 'Unassigned');
            const assigned_to_email_raw = handleEmptyValue(ticket.assigned_to_email);
            const system_name = handleStringField(ticket.system_name, 'Not Specified');
            const problem_details = handleStringField(ticket.problem_details, 'No details provided');
            const department = handleStringField(ticket.department, 'Not Specified');
            const branch = handleStringField(ticket.branch, 'Not Specified');
            const risk_label = handleStringField(ticket.risk_label, 'MEDIUM');
            const pc_name = handleStringField(ticket.pc_name, 'Not Mentioned');
            const down_time = handleEmptyValue(ticket.down_time);
            const up_time = handleEmptyValue(ticket.up_time);
            const resolution = handleEmptyValue(ticket.resolution);
            const root_cause = handleEmptyValue(ticket.root_cause);
            const remarks = handleEmptyValue(ticket.remarks);
            const remarks_by_admin = handleEmptyValue(ticket.remarks_by_admin);
            const special_instruction = handleEmptyValue(ticket.special_instruction);
            const status_from_excel = handleStringField(ticket.status, 'pending');
            const reporter_name_from_excel = handleStringField(ticket.reporter_name, null);

            // 🔍 FETCH reported_by_email from Users table by matching reporter_name
            let reported_by_email = null;
            let reporter_name = null;

            if (reporter_name_from_excel) {
                // Try to find user by name
                const userResult = await pool.request()
                    .input('name', sql.NVarChar, reporter_name_from_excel)
                    .query('SELECT email, name FROM Users WHERE name = @name');

                if (userResult.recordset.length > 0) {
                    reported_by_email = userResult.recordset[0].email;
                    reporter_name = userResult.recordset[0].name;
                    console.log(`✅ Found reporter: ${reporter_name} (${reported_by_email})`);
                } else {
                    console.log(`⚠️ Reporter not found in Users table: ${reporter_name_from_excel}`);
                    // Use admin as fallback for bulk import
                    reported_by_email = adminEmail;
                    reporter_name = adminName;
                }
            } else {
                // If no reporter name provided, use admin
                reported_by_email = adminEmail;
                reporter_name = adminName;
            }

            // 🔍 FETCH assigned_to_email from Users table by matching assigned_to_name
            let assigned_to_email = assigned_to_email_raw;
            if (!assigned_to_email && assigned_to_name && assigned_to_name !== 'Unassigned') {
                assigned_to_email = await getUserEmailByName(assigned_to_name, pool);
                if (assigned_to_email) {
                    console.log(`✅ Found assignee: ${assigned_to_name} (${assigned_to_email})`);
                }
            }

            // Validate required fields (only problem_details is truly required)
            const missingFields = [];
            if (!problem_details || problem_details === 'No details provided') {
                missingFields.push('problem_details');
            }

            if (missingFields.length > 0) {
                results.failed.push({
                    ticket_sl: providedTicketSl || `row_${i + 1}`,
                    reporter: reporter_name,
                    error: `Missing required fields: ${missingFields.join(', ')}`
                });
                continue;
            }

            // Generate ticket_sl if not provided
            let finalTicketSl = providedTicketSl;
            if (!finalTicketSl && date) {
                try {
                    const dateObj = new Date(date);
                    if (!isNaN(dateObj.getTime())) {
                        const day = String(dateObj.getDate()).padStart(2, '0');
                        const monthNum = String(dateObj.getMonth() + 1).padStart(2, '0');
                        const year = dateObj.getFullYear();
                        const datePart = `${day}${monthNum}${year}`;

                        const sequenceResult = await pool.request()
                            .input('datePart', sql.NVarChar, datePart)
                            .query(`
                                SELECT ISNULL(MAX(CAST(SUBSTRING(ticket_sl, CHARINDEX('-', ticket_sl) + 1, LEN(ticket_sl)) AS INT)), 0) + 1 AS seq
                                FROM Tickets
                                WHERE ticket_sl LIKE @datePart + '-%'
                            `);
                        const sequence = sequenceResult.recordset[0]?.seq || 1;
                        finalTicketSl = `${datePart}-${sequence}`;
                    } else {
                        finalTicketSl = `IMP-${Date.now()}-${i + 1}`;
                    }
                } catch (e) {
                    finalTicketSl = `IMP-${Date.now()}-${i + 1}`;
                }
            } else if (!finalTicketSl) {
                finalTicketSl = `IMP-${Date.now()}-${i + 1}`;
            }

            // Format dates
            let formattedDate = null;
            let formattedDownTime = null;
            let formattedUpTime = null;

            if (date) {
                try {
                    formattedDate = new Date(date);
                    if (isNaN(formattedDate.getTime())) formattedDate = null;
                } catch (e) {
                    formattedDate = null;
                }
            }

            if (down_time) {
                try {
                    formattedDownTime = new Date(down_time);
                    if (isNaN(formattedDownTime.getTime())) formattedDownTime = null;
                } catch (e) {
                    formattedDownTime = null;
                }
            }

            if (up_time) {
                try {
                    formattedUpTime = new Date(up_time);
                    if (isNaN(formattedUpTime.getTime())) formattedUpTime = null;
                } catch (e) {
                    formattedUpTime = null;
                }
            }

            // Determine status
            let finalStatus = status_from_excel.toLowerCase();
            if (finalStatus === 'pending' || finalStatus === 'open') {
                if (resolution && (resolution.toLowerCase() === 'solved' || resolution.toLowerCase() === 'resolved')) {
                    finalStatus = 'resolved';
                } else if (resolution && resolution.toLowerCase() === 'it task') {
                    finalStatus = 'in-progress';
                }
            }

            const finalRiskLabel = risk_label.toUpperCase();

            let finalMonth = month;
            if (!finalMonth && formattedDate) {
                finalMonth = formattedDate.toLocaleString('default', { month: 'long' });
            }

            // Optional: Validate that department, branch, system_name exist in static tables (optional - just log warning)
            const deptExists = await getStaticItemId(pool, 'Departments', 'name', department);
            const branchExists = await getStaticItemId(pool, 'Branches', 'name', branch);
            const systemExists = await getStaticItemId(pool, 'Systems', 'name', system_name);

            if (!deptExists && department !== 'Not Specified') {
                console.log(`⚠️ Warning: Department '${department}' not found in Departments table`);
            }
            if (!branchExists && branch !== 'Not Specified') {
                console.log(`⚠️ Warning: Branch '${branch}' not found in Branches table`);
            }
            if (!systemExists && system_name !== 'Not Specified') {
                console.log(`⚠️ Warning: System '${system_name}' not found in Systems table`);
            }

            // Insert ticket
            await pool.request()
                .input('ticket_sl', sql.NVarChar, finalTicketSl)
                .input('date', sql.Date, formattedDate)
                .input('month', sql.NVarChar, finalMonth)
                .input('system_name', sql.NVarChar, system_name)
                .input('problem_details', sql.NVarChar, problem_details)
                .input('department', sql.NVarChar, department)
                .input('branch', sql.NVarChar, branch)
                .input('risk_label', sql.NVarChar, finalRiskLabel)
                .input('affected_user', sql.NVarChar, affected_user)
                .input('assigned_to_email', sql.NVarChar, assigned_to_email)
                .input('assigned_to_name', sql.NVarChar, assigned_to_name)
                .input('pc_name', sql.NVarChar, pc_name)
                .input('down_time', sql.DateTime, formattedDownTime)
                .input('up_time', sql.DateTime, formattedUpTime)
                .input('resolution', sql.NVarChar, resolution)
                .input('root_cause', sql.NVarChar, root_cause)
                .input('remarks', sql.NVarChar, remarks)
                .input('remarks_by_admin', sql.NVarChar, remarks_by_admin)
                .input('special_instruction', sql.NVarChar, special_instruction)
                .input('reported_by_email', sql.NVarChar, reported_by_email)
                .input('reporter_name', sql.NVarChar, reporter_name)
                .input('status', sql.NVarChar, finalStatus)
                .query(`
                    INSERT INTO Tickets (
                        ticket_sl, date, month, system_name, problem_details, 
                        department, branch, risk_label, affected_user, 
                        assigned_to_email, assigned_to_name, pc_name, down_time, up_time,
                        resolution, root_cause, remarks, remarks_by_admin, special_instruction,
                        reported_by_email, reporter_name, status, created_at, updated_at
                    )
                    VALUES (
                        @ticket_sl, @date, @month, @system_name, @problem_details,
                        @department, @branch, @risk_label, @affected_user,
                        @assigned_to_email, @assigned_to_name, @pc_name, @down_time, @up_time,
                        @resolution, @root_cause, @remarks, @remarks_by_admin, @special_instruction,
                        @reported_by_email, @reporter_name, @status, GETDATE(), GETDATE()
                    )
                `);

            results.successful.push({
                ticket_sl: finalTicketSl,
                reporter: reporter_name,
                assignee: assigned_to_name,
                system: system_name,
                department: department,
                branch: branch
            });

            console.log(`✅ Ticket ${finalTicketSl} imported successfully`);

        } catch (err) {
            console.error(`❌ Error importing ticket ${i + 1}:`, err.message);
            results.failed.push({
                ticket_sl: ticket.ticket_sl || `row_${i + 1}`,
                reporter: ticket.reporter_name || 'Unknown',
                error: err.message
            });
        }
    }

    console.log("\n📊 ========== BULK IMPORT SUMMARY ==========");
    console.log(`✅ Successful: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);
    console.log(`📈 Success Rate: ${((results.successful.length / results.total) * 100).toFixed(1)}%`);

    res.status(200).json({
        message: `Bulk import completed: ${results.successful.length} successful, ${results.failed.length} failed`,
        summary: {
            total: results.total,
            successful: results.successful.length,
            failed: results.failed.length,
            success_rate: `${((results.successful.length / results.total) * 100).toFixed(1)}%`
        },
        results: results
    });
};