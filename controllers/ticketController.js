const { poolPromise, sql } = require('../config/db');
const { saveNotification } = require('./notificationController');
const AuditLog = require('../models/AuditLog');


const NOTIFY_SCOPE = {
    'Super Admin': 'all',
    'Admin': 'all',
    'IT User': 'all',
    'IT Member': 'all',
    'Read Only User': 'all',
    'Branch Admin': 'branch',
    'Department Head': 'department',
    'Branch User': 'own',
    'Department User': 'own',
};

// Returns an array of emails that should be notified about a ticket.
async function getNotificationRecipients(ticket) {
    const pool = await poolPromise;
    const usersResult = await pool.request().query(`
        SELECT u.id, u.email, u.branch, u.department, r.name AS role_name
        FROM Users u
        LEFT JOIN roles r ON u.role_id = r.id
    `);

    const norm = (s) => (s || '').trim().toLowerCase();
    const tBranch = norm(ticket.branch);
    const tDept = norm(ticket.department);

    const recipients = new Set();

    for (const u of usersResult.recordset) {
        const strategy = NOTIFY_SCOPE[u.role_name] || 'own';

        if (strategy === 'all') {
            if (u.email) recipients.add(u.email);
        } else if (strategy === 'branch') {
            if (tBranch && norm(u.branch) === tBranch && u.email) recipients.add(u.email);
        } else if (strategy === 'department') {
            if (tDept && norm(u.department) === tDept && u.email) recipients.add(u.email);
        }

        // 'own' rule — owner & assignee always get it, matched by ID (no email column needed)
        if (ticket.reported_by_id && u.id === ticket.reported_by_id && u.email) recipients.add(u.email);
        if (ticket.assigned_to_id && u.id === ticket.assigned_to_id && u.email) recipients.add(u.email);
    }

    // Fallback: if a caller already has the emails on hand, honor them too
    if (ticket.reported_by_email) recipients.add(ticket.reported_by_email);
    if (ticket.assigned_to_email) recipients.add(ticket.assigned_to_email);

    return [...recipients];
}

// Helper to get client IP
const getClientIp = (req) => {
    return req.headers['x-forwarded-for'] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        req.ip ||
        'unknown';
};


// Helper to get ALL users (both admin and regular users)
async function getAllUsers() {
    const pool = await poolPromise;
    const result = await pool.request().query("SELECT email, name, role FROM Users");
    return result.recordset;
}

// Helper to get user ID by email
async function getUserIdByEmail(email) {
    if (!email) return null;
    const pool = await poolPromise;
    const result = await pool.request()
        .input('email', sql.NVarChar, email)
        .query("SELECT id FROM Users WHERE email = @email");
    return result.recordset[0]?.id || null;
}

// Helper to get user email by ID
async function getUserEmailById(id) {
    if (!id) return null;
    const pool = await poolPromise;
    const result = await pool.request()
        .input('id', sql.Int, id)
        .query("SELECT email, name FROM Users WHERE id = @id");
    return result.recordset[0] || null;
}


// Add this function to track changes
async function logTicketAction(actionType, entityId, oldData, newData, req, changes = null) {
    const ip_address = getClientIp(req);

    await AuditLog.create({
        action_type: actionType,
        entity_type: 'TICKET',
        entity_id: entityId,
        old_value: oldData ? JSON.stringify(oldData) : null,
        new_value: newData ? JSON.stringify(newData) : null,
        changes: changes ? JSON.stringify(changes) : null,
        user_id: req.user.id,
        user_email: req.user.email,
        user_name: req.user.name,
        user_role: req.user.role,
        ip_address: ip_address,
        user_agent: req.headers['user-agent']
    });

    console.log(`📝 Audit logged: ${actionType} on TICKET #${entityId} by ${req.user.email} from IP: ${ip_address}`);
}

exports.getAllTickets = async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request().query(`
            SELECT 
                t.*, 
                COALESCE(u.name, t.reporter_name) as reportedByName,
                COALESCE(assigned_user.name, t.assigned_to_name) as assignedToName,
                u.email as reported_by_email,
                assigned_user.email as assigned_to_email
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_id = u.id
            LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
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

        // Resolve the user's authoritative role and branch for role-based My Tickets scope.
        const currentUserResult = await pool.request()
            .input('userEmail', sql.NVarChar, userEmail)
            .query(`
                SELECT u.id, u.branch, r.name AS role_name
                FROM Users u
                LEFT JOIN roles r ON u.role_id = r.id
                WHERE u.email = @userEmail
            `);
        const currentUser = currentUserResult.recordset[0];
        if (!currentUser) return res.status(404).json({ message: 'User not found' });
        const isBranchAdmin = currentUser.role_name === 'Branch Admin';

        const result = await pool.request()
            .input('userId', sql.Int, currentUser.id)
            .input('userBranch', sql.NVarChar, currentUser.branch || null)
            .input('isBranchAdmin', sql.Bit, isBranchAdmin ? 1 : 0)
            .query(`
                SELECT 
                    t.*, 
                    COALESCE(u.name, t.reporter_name) as reportedByName,
                    COALESCE(assigned_user.name, t.assigned_to_name) as assignedToName,
                    u.email as reported_by_email,
                    assigned_user.email as assigned_to_email
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_id = u.id
                LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
                WHERE t.reported_by_id = @userId
                   OR t.assigned_to_id = @userId
                   OR (@isBranchAdmin = 1 AND t.branch = @userBranch)
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
// ── Role → ticket visibility strategy ────────────────────────────────────────
// 'all'        → no restriction
// 'branch'     → tickets in the user's branch (plus ones they reported/are assigned)
// 'department' → tickets in the user's department (plus their own)
// 'own'        → only tickets they reported or are assigned to
// Unknown/new roles default to 'own' (least privilege) until added here.
const TICKET_SCOPE_STRATEGY = {
    'Super Admin': 'all',
    'Admin': 'all',
    'IT User': 'all',
    'IT Member': 'all',
    'Read Only User': 'all',     // read-only is enforced by permissions, not visibility
    'Branch Admin': 'branch',
    'Department Head': 'department',
    'Branch User': 'own',
    // 👉 add future roles here, e.g. 'Regional Manager': 'branch'
};

/**
 * Builds the ticket-visibility scope for the current user.
 * Returns { clause, apply } where:
 *   clause → SQL fragment to append to a WHERE (starts with ' AND ...' or '')
 *   apply  → fn(request) that binds the scope params onto an mssql request
 * Reads branch/department/id from the DB (authoritative), so stale token values
 * never cause a mismatch. Only hits the DB for roles that actually need scoping.
 */
/**
 * Builds the ticket-visibility scope for the current user.
 * Resolves role (via role_id → roles.name), branch, department, and id from the
 * DB in one query, so a stale token role/branch can never cause wrong scoping.
 */
async function buildTicketScope(pool, reqUser) {
    let id = null, branch = null, department = null;
    let roleName = reqUser.role || null;

    if (reqUser.email) {
        const r = await pool.request()
            .input('email', sql.NVarChar, reqUser.email)
            .query(`
                SELECT u.id, u.branch, u.department, r.name AS role_name
                FROM Users u
                LEFT JOIN roles r ON u.role_id = r.id
                WHERE u.email = @email
            `);
        const me = r.recordset[0];
        if (me) {
            id = me.id ?? null;
            branch = me.branch ?? null;
            department = me.department ?? null;
            roleName = me.role_name || roleName;   // authoritative role name from role_id
        }
    }

    const strategy = TICKET_SCOPE_STRATEGY[roleName] || 'own';

    // 'all' roles → no restriction
    if (strategy === 'all') {
        return { clause: '', apply: (req) => req, roleName, strategy, scopeBranch: branch };
    }

    const ownClause = '(t.reported_by_id = @scopeUserId OR t.assigned_to_id = @scopeUserId)';
    const binds = [{ name: 'scopeUserId', type: sql.Int, value: id }];
    let clause = ` AND ${ownClause}`;

    if (strategy === 'branch' && branch) {
        binds.push({ name: 'scopeBranch', type: sql.NVarChar, value: branch });
        clause = ` AND (LTRIM(RTRIM(t.branch)) = LTRIM(RTRIM(@scopeBranch)) OR ${ownClause})`;
    } else if (strategy === 'department' && department) {
        binds.push({ name: 'scopeDept', type: sql.NVarChar, value: department });
        clause = ` AND (LTRIM(RTRIM(t.department)) = LTRIM(RTRIM(@scopeDept)) OR ${ownClause})`;
    }

    const apply = (request) => {
        for (const b of binds) request.input(b.name, b.type, b.value);
        return request;
    };

    return { clause, apply, roleName, strategy, scopeUserId: id, scopeBranch: branch, scopeDept: department };
}


// ============================================
// GET PAGINATED TICKETS
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

        const risk = req.query.risk || '';
        const system = req.query.system || '';
        const department = req.query.department || '';
        const branch = req.query.branch || '';

        console.log('📊 Fetching tickets with filters:', { page, pageSize, status, search, dateFilter, sortBy });

        let whereClause = 'WHERE 1=1';
        const params = {};

        // ── ROLE-BASED SCOPING (shared helper) ──
        const scope = await buildTicketScope(pool, req.user);
        whereClause += scope.clause;
        console.log('🔐 Ticket scope:', { role: scope.roleName, strategy: scope.strategy, branch: scope.scopeBranch });

        // ── Advanced filters ──
        if (risk) { whereClause += ' AND t.risk_label = @risk'; params.risk = risk; }
        if (system) { whereClause += ' AND t.system_name = @system'; params.system = system; }
        if (department) { whereClause += ' AND t.department = @department'; params.department = department; }
        if (branch) { whereClause += ' AND t.branch = @branch'; params.branch = branch; }

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
                assigned_user.name LIKE @search OR
                t.ticket_sl LIKE @search
            )`;
            params.search = `%${search}%`;
        }

        // Date filter
        if (dateFilter !== 'all') {
            const dateRange = getDateRangeForFilter(dateFilter);
            if (dateRange.startDate && dateRange.endDate) {
                whereClause += ' AND t.date >= @startDate AND t.date <= @endDate';
                params.startDate = dateRange.startDate;
                params.endDate = dateRange.endDate;
            }
        }

        // Build ORDER BY
        let orderBy = 'ORDER BY t.created_at DESC';
        if (sortBy === 'status') orderBy = 'ORDER BY t.status';
        else if (sortBy === 'risk') {
            orderBy = `ORDER BY CASE t.risk_label WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC`;
        }

        // Bind a (non-scope) param onto a request with the correct type
        const bindParam = (request, key, value) => {
            if (key === 'startDate' || key === 'endDate') request.input(key, sql.Date, value);
            else request.input(key, sql.NVarChar, value);
        };

        // Count
        const countRequest = pool.request();
        for (const [key, value] of Object.entries(params)) bindParam(countRequest, key, value);
        scope.apply(countRequest);

        const countResult = await countRequest.query(`
            SELECT COUNT(*) as total
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_id = u.id
            LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
            ${whereClause}
        `);
        const totalCount = countResult.recordset[0].total;

        // Data
        const dataRequest = pool.request();
        for (const [key, value] of Object.entries(params)) bindParam(dataRequest, key, value);
        scope.apply(dataRequest);
        dataRequest.input('offset', sql.Int, offset);
        dataRequest.input('pageSize', sql.Int, pageSize);

        const result = await dataRequest.query(`
            SELECT 
                t.*, 
                COALESCE(u.name, t.reporter_name) as reportedByName,
                COALESCE(assigned_user.name, t.assigned_to_name) as assignedToName,
                u.id as reported_by_id,
                assigned_user.id as assigned_to_id
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_id = u.id
            LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
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

        // ── ROLE-BASED SCOPING (shared helper) ──
        const scope = await buildTicketScope(pool, req.user);
        const scopeClause = scope.clause;
        const bindScope = scope.apply;
        console.log('🔐 Stats scope:', { role: scope.roleName, strategy: scope.strategy, branch: scope.scopeBranch });

        const getComparisonLabel = (filter) => {
            switch (filter) {
                case 'today': return 'vs yesterday';
                case 'yesterday': return 'vs day before';
                case 'week': return 'vs last week';
                case 'month': return 'vs last month';
                case 'quarter': return 'vs last quarter';
                case 'year': return 'vs last year';
                default: return '';
            }
        };

        const fetchStatsForRange = async (startDate, endDate) => {
            if (!startDate || !endDate) {
                return { total_tickets: 0, open_count: 0, in_progress_count: 0, resolved_count: 0 };
            }
            const request = pool.request();
            request.input('startDate', sql.Date, startDate);
            request.input('endDate', sql.Date, endDate);
            bindScope(request);
            const result = await request.query(`
                SELECT 
                    COUNT(*) as total_tickets,
                    SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) as open_count,
                    SUM(CASE WHEN t.status = 'in-progress' THEN 1 ELSE 0 END) as in_progress_count,
                    SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) as resolved_count
                FROM Tickets t
                WHERE t.date >= @startDate AND t.date <= @endDate
                ${scopeClause}
            `);
            return result.recordset[0] || { total_tickets: 0, open_count: 0, in_progress_count: 0, resolved_count: 0 };
        };

        const fetchDetailedStats = async (startDate, endDate) => {
            const request = pool.request();
            let whereClause = 'WHERE 1=1';
            if (startDate && endDate) {
                request.input('startDate', sql.Date, startDate);
                request.input('endDate', sql.Date, endDate);
                whereClause += ' AND t.date >= @startDate AND t.date <= @endDate';
            }
            whereClause += scopeClause;
            bindScope(request);
            const result = await request.query(`
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
            return result.recordset[0];
        };

        // SLA for current month (scoped)
        const fetchSla = async () => {
            const now = new Date();
            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            monthStart.setHours(0, 0, 0, 0);
            const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            monthEnd.setHours(23, 59, 59, 999);

            const slaRequest = pool.request();
            slaRequest.input('monthStart', sql.DateTime, monthStart);
            slaRequest.input('monthEnd', sql.DateTime, monthEnd);
            bindScope(slaRequest);

            const slaResult = await slaRequest.query(`
                SELECT 
                    COUNT(*) as total_resolved,
                    SUM(CASE WHEN DATEDIFF(MINUTE, t.created_at, t.updated_at) <= 240 THEN 1 ELSE 0 END) as sla_met
                FROM Tickets t
                WHERE t.status = 'resolved'
                    AND t.updated_at >= @monthStart AND t.updated_at <= @monthEnd
                    ${scopeClause}
            `);

            const slaData = slaResult.recordset[0] || {};
            const slaTotal = slaData.total_resolved || 0;
            const slaMet = slaData.sla_met || 0;
            return {
                percentage: slaTotal > 0 ? Number(((slaMet / slaTotal) * 100).toFixed(1)) : 0,
                met: slaMet,
                total: slaTotal,
                breaches: slaTotal - slaMet
            };
        };

        const buildCharts = (s) => ({
            statusChartData: [
                { name: "Open", value: s.open_count || 0, color: "#ef4444" },
                { name: "In Progress", value: s.in_progress_count || 0, color: "#eab308" },
                { name: "Resolved", value: s.resolved_count || 0, color: "#22c55e" }
            ].filter(i => i.value > 0),
            riskChartData: [
                { name: "Low Risk", value: s.low_risk_count || 0, color: "#3b82f6" },
                { name: "Medium Risk", value: s.medium_risk_count || 0, color: "#f97316" },
                { name: "High Risk", value: s.high_risk_count || 0, color: "#ef4444" }
            ].filter(i => i.value > 0)
        });

        // ── MAIN LOGIC ──
        let comparisons = { total: null, open: null, progress: null, resolved: null };
        let currentStats, statusChartData = [], riskChartData = [];

        if (dateFilter === 'all') {
            currentStats = await fetchDetailedStats(null, null);
            ({ statusChartData, riskChartData } = buildCharts(currentStats));
        } else {
            const dateRange = getDateRangeForFilter(dateFilter);
            if (dateRange.startDate && dateRange.endDate) {
                currentStats = await fetchDetailedStats(dateRange.startDate, dateRange.endDate);
                ({ statusChartData, riskChartData } = buildCharts(currentStats));

                // previous period for comparison
                const startObj = new Date(dateRange.startDate);
                const endObj = new Date(dateRange.endDate);
                const durationDays = Math.ceil((endObj - startObj) / (1000 * 60 * 60 * 24));
                const prevEnd = new Date(startObj); prevEnd.setDate(prevEnd.getDate() - 1);
                const prevStart = new Date(prevEnd); prevStart.setDate(prevEnd.getDate() - durationDays + 1);

                const previousStats = await fetchStatsForRange(
                    prevStart.toISOString().split('T')[0],
                    prevEnd.toISOString().split('T')[0]
                );

                const label = getComparisonLabel(dateFilter);
                const buildComparison = (cur = 0, prev = 0) => {
                    if (prev === 0 && cur === 0) return { value: 0, percentage: null, isIncrease: false, label, display: 'No change' };
                    if (prev === 0 && cur > 0) return { value: cur, percentage: 100, isIncrease: true, label, display: `↑ 100% ${label}` };
                    const diff = cur - prev;
                    const pct = Number(((Math.abs(diff) / prev) * 100).toFixed(1));
                    return { value: Math.abs(diff), percentage: pct, isIncrease: diff >= 0, label, display: `${diff >= 0 ? '↑' : '↓'} ${pct}% ${label}` };
                };

                comparisons = {
                    total: buildComparison(currentStats.total_tickets, previousStats.total_tickets),
                    open: buildComparison(currentStats.open_count, previousStats.open_count),
                    progress: buildComparison(currentStats.in_progress_count, previousStats.in_progress_count),
                    resolved: buildComparison(currentStats.resolved_count, previousStats.resolved_count)
                };
            } else {
                currentStats = await fetchDetailedStats(null, null);
                ({ statusChartData, riskChartData } = buildCharts(currentStats));
            }
        }

        const slaAchievement = await fetchSla();

        res.json({
            stats: {
                total: currentStats?.total_tickets || 0,
                open: currentStats?.open_count || 0,
                progress: currentStats?.in_progress_count || 0,
                resolved: currentStats?.resolved_count || 0,
                activeTotal: currentStats?.active_tickets || 0,
                highRisk: currentStats?.high_risk_count || 0,
                mediumRisk: currentStats?.medium_risk_count || 0,
                lowRisk: currentStats?.low_risk_count || 0
            },
            comparisons,
            slaAchievement,
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



// ============================================
// AUDIT HELPER FUNCTIONS FOR HUMAN-READABLE FORMAT
// ============================================

// Format date for human readability
const formatDateForAudit = (dateValue) => {
    if (!dateValue) return 'Not set';
    try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return String(dateValue);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
    } catch (e) {
        return String(dateValue);
    }
};

// Format any value for audit display
const formatValueForAudit = (value) => {
    if (value === null || value === undefined || value === '') return 'Not set';
    if (typeof value === 'string' && (value.includes('T') || value.includes('Z'))) {
        return formatDateForAudit(value);
    }
    if (value instanceof Date) {
        return formatDateForAudit(value);
    }
    return String(value);
};

// Get readable status action description
const getStatusActionDescription = (oldStatus, newStatus) => {
    if (newStatus === 'open' && oldStatus === 'in-progress') {
        return { action: 'reopened', text: 'reopened the ticket' };
    }
    if (newStatus === 'open' && oldStatus === 'resolved') {
        return { action: 'reopened from resolved', text: 'reopened the resolved ticket' };
    }
    if (newStatus === 'in-progress') {
        return { action: 'started working on', text: 'started working on the ticket' };
    }
    if (newStatus === 'resolved') {
        return { action: 'resolved', text: 'resolved the ticket' };
    }
    return {
        action: `changed status from ${oldStatus} to ${newStatus}`,
        text: `changed status from ${oldStatus} to ${newStatus}`
    };
};

// Get readable field name
const getReadableFieldName = (field) => {
    const fieldMap = {
        'system_name': 'System',
        'problem_details': 'Problem Details',
        'department': 'Department',
        'branch': 'Branch',
        'risk_label': 'Risk Level',
        'affected_user': 'Affected User',
        'assigned_to_name': 'Assigned To',
        'pc_name': 'PC Name',
        'down_time': 'Down Time',
        'up_time': 'Up Time',
        'status': 'Status',
        'root_cause': 'Root Cause',
        'resolution': 'Resolution',
        'remarks_by_admin': 'Admin Remarks'
    };
    return fieldMap[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// Updated logTicketAction with human-readable formatting
async function logTicketAction(actionType, entityId, oldData, newData, req, customData = null) {
    const ip_address = getClientIp(req);

    // Create human-readable change description
    let humanReadableChanges = {};
    let changeSummary = '';
    let fullDescription = '';

    if (customData && customData.changes && Object.keys(customData.changes).length > 0) {
        const changeDescriptions = [];

        for (const [key, change] of Object.entries(customData.changes)) {
            // Format old and new values
            const oldVal = formatValueForAudit(change.old);
            const newVal = formatValueForAudit(change.new);

            humanReadableChanges[key] = {
                old: oldVal,
                new: newVal
            };

            // Create a human-readable sentence for this change
            if (key === 'status' && change.action) {
                changeDescriptions.push(change.action);
            } else if (key === 'assigned_to') {
                changeDescriptions.push(`assigned to ${newVal}`);
            } else if (key === 'Risk Level') {
                changeDescriptions.push(`risk changed from ${oldVal} to ${newVal}`);
            } else if (key === 'Down Time') {
                changeDescriptions.push(`down time set to ${newVal}`);
            } else if (key === 'Up Time') {
                changeDescriptions.push(`up time set to ${newVal}`);
            } else {
                changeDescriptions.push(`${key.toLowerCase()} changed from "${oldVal}" to "${newVal}"`);
            }
        }

        changeSummary = changeDescriptions.join(', ');
        fullDescription = `${req.user.name} ${actionType.toLowerCase()}d ticket ${entityId}: ${changeSummary}`;
    } else if (actionType === 'CREATE') {
        fullDescription = `${req.user.name} created ticket ${entityId}`;
        changeSummary = 'Ticket created';
    } else if (actionType === 'DELETE') {
        fullDescription = `${req.user.name} deleted ticket ${entityId}`;
        changeSummary = 'Ticket deleted';
    }

    // Format old and new values for the entire object
    let formattedOldValue = null;
    let formattedNewValue = null;

    if (oldData) {
        const formattedOld = {};
        for (const [key, value] of Object.entries(oldData)) {
            formattedOld[getReadableFieldName(key)] = formatValueForAudit(value);
        }
        formattedOldValue = JSON.stringify(formattedOld, null, 2);
    }

    if (newData) {
        const formattedNew = {};
        for (const [key, value] of Object.entries(newData)) {
            formattedNew[getReadableFieldName(key)] = formatValueForAudit(value);
        }
        formattedNewValue = JSON.stringify(formattedNew, null, 2);
    }

    // Store everything in the changes field
    const finalChanges = {
        summary: changeSummary,
        full_description: fullDescription,
        details: humanReadableChanges,
        timestamp: new Date().toISOString(),
        user: req.user.name,
        action: actionType
    };

    await AuditLog.create({
        action_type: actionType,
        entity_type: 'TICKET',
        entity_id: entityId,
        old_value: formattedOldValue,
        new_value: formattedNewValue,
        changes: JSON.stringify(finalChanges, null, 2),
        user_id: req.user.id,
        user_email: req.user.email,
        user_name: req.user.name,
        user_role: req.user.role,
        ip_address: ip_address,
        user_agent: req.headers['user-agent']
    });

    console.log(`📝 Audit logged: ${fullDescription}`);
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
        downTime,
        ticketFor
    } = req.body;

    const canAssignAndSetRisk = ['Super Admin', 'Admin', 'IT User'].includes(req.user.role);
    const useSignedInProfile = !canAssignAndSetRisk && ticketFor !== 'other';
    const effectiveAffectedUser = useSignedInProfile
        ? String(req.user.employee_id || req.user.id)
        : affectedUser;
    const effectiveDepartment = useSignedInProfile
        ? req.user.department
        : department;
    const effectiveBranch = useSignedInProfile
        ? req.user.branch
        : branch;
    const effectivePcName = useSignedInProfile
        ? req.user.pc_name
        : pcName;

    const missingFields = [];
    if (!systemName) missingFields.push('systemName');
    if (!problemDetails) missingFields.push('problemDetails');
    if (!effectiveDepartment) missingFields.push('department');
    if (!effectiveBranch) missingFields.push('branch');
    if (!effectiveAffectedUser) missingFields.push('affectedUser');
    if (!effectivePcName || !String(effectivePcName).trim()) missingFields.push('pcName');

    if (missingFields.length > 0) {
        console.log("❌ Missing required fields:", missingFields);
        return res.status(400).json({
            message: `Missing required fields: ${missingFields.join(', ')}`,
            received: req.body
        });
    }

    const reportedByEmail = req.user.email;
    const reporterName = req.user.name;
    const effectiveRiskLabel = canAssignAndSetRisk && ['LOW', 'MEDIUM', 'HIGH'].includes(String(riskLabel || '').toUpperCase())
        ? String(riskLabel).toUpperCase()
        : 'LOW';
    const effectiveAssignedToEmail = canAssignAndSetRisk ? (assignedToEmail || null) : null;
    const effectiveAssignedToName = canAssignAndSetRisk ? (assignedToName || 'Unassigned') : 'Unassigned';

    try {
        const pool = await poolPromise;

        // Get reporter user ID
        const reporterId = await getUserIdByEmail(reportedByEmail);
        if (!reporterId) {
            return res.status(400).json({ message: 'Reporter user not found' });
        }

        // Get assignee user ID if provided
        let assignedToId = null;
        if (effectiveAssignedToEmail) {
            assignedToId = await getUserIdByEmail(effectiveAssignedToEmail);
        }

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

        const finalAssignedToName = effectiveAssignedToName;

        // Prepare new ticket data for audit
        const newTicketData = {
            ticket_sl: ticket_sl,
            system_name: systemName,
            problem_details: problemDetails,
            department: effectiveDepartment,
            branch: effectiveBranch,
            risk_label: effectiveRiskLabel,
            affected_user: effectiveAffectedUser,
            assigned_to_email: effectiveAssignedToEmail,
            assigned_to_name: finalAssignedToName,
            status: 'open',
            reporter_name: reporterName,
            reported_by_email: reportedByEmail
        };

        // Insert ticket with IDs
        // Insert ticket with IDs
        await pool.request()
            .input('ticket_sl', sql.NVarChar, ticket_sl)
            .input('date', sql.Date, date || new Date())
            .input('month', sql.NVarChar, new Date(date || new Date()).toLocaleString('default', { month: 'long' }))
            .input('systemName', sql.NVarChar, systemName)
            .input('problemDetails', sql.NVarChar, problemDetails)
            .input('department', sql.NVarChar, effectiveDepartment)
            .input('branch', sql.NVarChar, effectiveBranch)
            .input('riskLabel', sql.NVarChar, effectiveRiskLabel)
            .input('affectedUser', sql.NVarChar, effectiveAffectedUser)
            .input('assignedToId', sql.Int, assignedToId)
            .input('assignedToName', sql.NVarChar, finalAssignedToName)
            .input('pcName', sql.NVarChar, effectivePcName)
            .input('downTime', sql.DateTime, formattedDownTime || new Date())
            .input('reportedById', sql.Int, reporterId)
            .input('reporterName', sql.NVarChar, reporterName)
            .query(`
                INSERT INTO Tickets (
                    ticket_sl, date, month, system_name, problem_details, 
                    department, branch, risk_label, affected_user, 
                    assigned_to_id, assigned_to_name, pc_name, down_time, 
                    reported_by_id, reporter_name, status, created_at, updated_at
                )
                VALUES (
                    @ticket_sl, @date, @month, @systemName, @problemDetails,
                    @department, @branch, @riskLabel, @affectedUser,
                    @assignedToId, @assignedToName, @pcName, @downTime,
                    @reportedById, @reporterName, 'open', GETUTCDATE(), GETUTCDATE()
                )
            `);

        console.log("✅ Ticket inserted successfully:", ticket_sl);

        // ✅ AUDIT LOG: Ticket creation (now newTicketData is defined)
        await logTicketAction('CREATE', ticket_sl, null, newTicketData, req, {
            created: newTicketData,
            details: `${req.user.name} created ticket ${ticket_sl} for system: ${systemName}`
        });

        // Send notifications (keep existing notification logic but use email for lookup)
        const allUsers = await getAllUsers();
        console.log(`📢 Sending notifications to ${allUsers.length} users...`);

        const riskEmoji = effectiveRiskLabel === 'HIGH' ? '🔴' : effectiveRiskLabel === 'MEDIUM' ? '🟡' : '🟢';
        const notification = {
            type: 'new_ticket',
            title: '📢 New Ticket Created',
            message: `${reporterName} created ticket ${ticket_sl}: ${systemName} ${riskEmoji}`,
        };

        const io = req.app.get('io');
        const connectedUsers = req.app.get('connectedUsers');

        // Scoped recipients (resolved by ID — no email column needed)
        const recipients = await getNotificationRecipients({
            branch: effectiveBranch,
            department: effectiveDepartment,
            reported_by_id: reporterId,
            assigned_to_id: assignedToId,        // null if unassigned at creation
            reported_by_email: reportedByEmail,  // we have these here, so pass them too
            assigned_to_email: effectiveAssignedToEmail,
        });
        console.log(`📢 Notifying ${recipients.length} scoped recipients...`);

        for (const email of recipients) {
            if (email === reportedByEmail) continue;   // don't notify the creator
            await saveNotification(email, notification, ticket_sl);
            const socketId = connectedUsers?.get(email);
            if (socketId && io) {
                io.to(socketId).emit('notification', {
                    ...notification,
                    id: ticket_sl,
                    created_at: new Date().toISOString(),
                    is_read: 0
                });
            }
        }

        if (io) {
            io.emit('ticket-created', {
                ticket: {
                    ticket_sl: ticket_sl,
                    systemName: systemName,
                    reporterName: reporterName,
                    status: 'open',
                    riskLevel: effectiveRiskLabel,
                    createdAt: new Date()
                },
                message: `New ticket ${ticket_sl} created by ${reporterName}`
            });
            io.emit('stats-updated', { reason: 'new_ticket', timestamp: new Date() });
        }

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
    const ip_address = getClientIp(req);

    console.log("📥 Update request for ticket:", id);
    console.log("📦 Update data:", updates);
    console.log("👤 Updated by:", req.user?.email);

    const allowed = [
        'status', 'assigned_to_name', 'assigned_to_email', 'up_time',
        'root_cause', 'resolution', 'remarks', 'remarks_by_admin', 'special_instruction',
        'risk_label', 'system_name', 'department', 'branch',
        'affected_user', 'pc_name', 'down_time', 'problem_details', 'assigned_to_id'
    ];

    const setClause = [];
    const pool = await poolPromise;
    const request = pool.request();
    request.input('id', sql.Int, id);

    // Get old ticket data with IDs
    const oldTicketResult = await pool.request()
        .input('id', sql.Int, id)
        .query(`
            SELECT 
                t.*,
                u.name as reportedByName,
                u.email as reported_by_email,
                assigned_user.name as assignedToName,
                assigned_user.email as assigned_to_email
            FROM Tickets t
            LEFT JOIN Users u ON t.reported_by_id = u.id
            LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
            WHERE t.id = @id
        `);

    const oldTicket = oldTicketResult.recordset[0];

    if (!oldTicket) {
        return res.status(404).json({ message: 'Ticket not found' });
    }

    if (
        oldTicket.status === 'resolved' &&
        updates.status !== undefined &&
        updates.status !== 'resolved'
    ) {
        return res.status(409).json({ message: 'Resolved tickets cannot be reopened' });
    }

    if (oldTicket.status === 'resolved') {
        const oldAssigneeEmail = String(oldTicket.assigned_to_email || '').trim().toLowerCase();
        const requestedAssigneeEmail = String(updates.assigned_to_email || '').trim().toLowerCase();
        const emailAssignmentChanged =
            updates.assigned_to_email !== undefined &&
            requestedAssigneeEmail !== oldAssigneeEmail;
        const idAssignmentChanged =
            updates.assigned_to_id !== undefined &&
            Number(updates.assigned_to_id || 0) !== Number(oldTicket.assigned_to_id || 0);

        if (emailAssignmentChanged || idAssignmentChanged) {
            return res.status(409).json({ message: 'Resolved tickets cannot be reassigned' });
        }
    }

    const isAdminUser = ['Admin', 'Super Admin'].includes(req.user?.role);
    const canAddResolutionInstruction = ['IT User', 'Admin', 'Super Admin'].includes(req.user?.role);
    if (updates.remarks_by_admin !== undefined && !isAdminUser) {
        return res.status(403).json({ message: 'Only Admin or Super Admin can add admin remarks' });
    }
    if (updates.special_instruction !== undefined && !canAddResolutionInstruction) {
        return res.status(403).json({ message: 'Only IT User, Admin, or Super Admin can add a special instruction' });
    }
    if (updates.status === 'resolved') {
        if (!String(updates.root_cause || '').trim()) {
            return res.status(400).json({ message: 'Root cause is required to resolve a ticket' });
        }
        if (!updates.up_time || Number.isNaN(new Date(updates.up_time).getTime())) {
            return res.status(400).json({ message: 'A valid up time is required to resolve a ticket' });
        }
    }

    console.log("📋 Old ticket data:", {
        id: oldTicket.id,
        ticket_sl: oldTicket.ticket_sl,
        status: oldTicket.status,
        assigned_to_id: oldTicket.assigned_to_id,
        risk_label: oldTicket.risk_label
    });

    // Track changes for audit
    const changes = {};
    let newTicketData = { ...oldTicket };

    // Helper function to check if value is actually changed (ignoring null/empty string differences)
    const hasChanged = (oldVal, newVal) => {
        const normalize = (val) => {
            if (val === null || val === undefined || val === '') return null;
            return val;
        };
        return normalize(oldVal) !== normalize(newVal);
    };

    for (let field of allowed) {
        if (updates[field] !== undefined) {
            if (field === 'assigned_to_email' && updates[field]) {
                // Convert email to ID
                const userId = await getUserIdByEmail(updates[field]);
                if (userId) {
                    setClause.push('assigned_to_id = @assigned_to_id');
                    request.input('assigned_to_id', sql.Int, userId);

                    const userInfo = await getUserEmailById(userId);
                    if (userInfo) {
                        setClause.push('assigned_to_name = @assigned_to_name');
                        request.input('assigned_to_name', sql.NVarChar, userInfo.name);

                        if (hasChanged(oldTicket.assigned_to_name, userInfo.name)) {
                            changes['assigned_to'] = {
                                old: oldTicket.assigned_to_name || 'Unassigned',
                                new: userInfo.name
                            };
                            newTicketData.assigned_to_name = userInfo.name;
                            newTicketData.assigned_to_email = updates[field];
                        }
                    }
                }
            } else if (field === 'status') {
                setClause.push('status = @status');
                request.input('status', sql.NVarChar, updates[field]);

                if (hasChanged(oldTicket.status, updates[field])) {
                    let actionDescription = '';
                    if (updates[field] === 'open' && oldTicket.status === 'in-progress') {
                        actionDescription = 'reopened';
                    } else if (updates[field] === 'open' && oldTicket.status === 'resolved') {
                        actionDescription = 'reopened from resolved';
                    } else if (updates[field] === 'in-progress') {
                        actionDescription = 'started working on';
                    } else if (updates[field] === 'resolved') {
                        actionDescription = 'resolved';
                    } else {
                        actionDescription = `changed status from ${oldTicket.status} to ${updates[field]}`;
                    }

                    changes['status'] = {
                        old: oldTicket.status || 'Not set',
                        new: updates[field],
                        action: actionDescription
                    };
                    newTicketData.status = updates[field];
                }
            } else if (field === 'up_time' || field === 'down_time') {
                let dateValue = updates[field];
                if (dateValue) {
                    const parsedDate = new Date(dateValue);
                    if (!isNaN(parsedDate.getTime())) {
                        dateValue = parsedDate;
                    } else {
                        dateValue = null;
                    }
                }
                setClause.push(`${field} = @${field}`);
                request.input(field, sql.DateTime, dateValue || null);

                const oldValue = oldTicket[field];
                const newValue = dateValue;
                if (hasChanged(oldValue, newValue)) {
                    const fieldDisplay = field === 'up_time' ? 'Up Time' : 'Down Time';
                    changes[fieldDisplay] = {
                        old: oldValue ? new Date(oldValue).toLocaleString() : 'Not set',
                        new: newValue ? new Date(newValue).toLocaleString() : 'Not set'
                    };
                    newTicketData[field] = dateValue;
                }
            } else if (field === 'risk_label') {
                setClause.push(`${field} = @${field}`);
                request.input(field, sql.NVarChar, updates[field]);

                if (hasChanged(oldTicket[field], updates[field])) {
                    changes['Risk Level'] = {
                        old: oldTicket[field] || 'Not set',
                        new: updates[field]
                    };
                    newTicketData[field] = updates[field];
                }
            } else if (field === 'assigned_to_id') {
                continue;
            } else if (field !== 'assigned_to_email') {
                setClause.push(`${field} = @${field}`);
                request.input(field, sql.NVarChar, updates[field]);

                // Only log if value actually changed (ignore null vs empty string)
                if (hasChanged(oldTicket[field], updates[field])) {
                    const fieldDisplay = field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                    changes[fieldDisplay] = {
                        old: oldTicket[field] || 'Not set',
                        new: updates[field] || 'Not set'
                    };
                    newTicketData[field] = updates[field];
                }
            }
        }
    }

    if (setClause.length === 0) {
        return res.status(400).json({ message: 'No valid fields to update' });
    }

    setClause.push('updated_at = GETUTCDATE()');

    try {
        const query = `UPDATE Tickets SET ${setClause.join(', ')} WHERE id = @id`;
        console.log("📝 Update query:", query);
        await request.query(query);

        // Get updated ticket
        const updatedTicketResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT 
                    t.*,
                    COALESCE(u.name, t.reporter_name) as reportedByName,
                    COALESCE(assigned_user.name, t.assigned_to_name) as assignedToName,
                    u.email as reported_by_email,
                    assigned_user.email as assigned_to_email
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_id = u.id
                LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
                WHERE t.id = @id
            `);

        const updatedTicket = updatedTicketResult.recordset[0];
        newTicketData = { ...newTicketData, ...updatedTicket };

        // ✅ Create change summary (FIX: define changeSummary here)
        let changeSummary = 'No significant changes';
        if (Object.keys(changes).length > 0) {
            changeSummary = Object.keys(changes).map(key => {
                if (key === 'status' && changes[key].action) {
                    return `${changes[key].action}`;
                }
                return `${key}: from "${changes[key].old}" to "${changes[key].new}"`;
            }).join(', ');
        }

        // ✅ AUDIT LOG: Ticket update
        if (Object.keys(changes).length > 0) {
            await logTicketAction('UPDATE', oldTicket.ticket_sl, oldTicket, newTicketData, req, {
                changes: changes,
                summary: changeSummary,
                details: `${req.user.name} updated ticket ${oldTicket.ticket_sl}: ${changeSummary}`,
                ip: ip_address
            });

            console.log(`📝 Audit: Ticket ${oldTicket.ticket_sl} updated - Changes: ${changeSummary}`);
        } else {
            console.log(`📝 No significant changes detected for ticket ${oldTicket.ticket_sl}`);
        }

        // Send notifications (keep existing logic)
        const io = req.app.get('io');
        const connectedUsers = req.app.get('connectedUsers');
        const updatedBy = req.user?.name || req.user?.email || 'System';

        // Status change notification
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
                message: `${updatedBy} ${action} ticket ${oldTicket.ticket_sl}${updates.status === 'resolved' && updates.remarks?.trim() ? `. Remarks: ${updates.remarks.trim()}` : ''}${updates.status === 'resolved' && updates.special_instruction?.trim() ? `. Instruction: ${updates.special_instruction.trim()}` : ''}`
            };

            const usersToNotify = await getNotificationRecipients({
                branch: oldTicket.branch,
                department: oldTicket.department,
                reported_by_id: oldTicket.reported_by_id,
                assigned_to_id: oldTicket.assigned_to_id,
                reported_by_email: oldTicket.reported_by_email,  // from the JOIN alias
                assigned_to_email: oldTicket.assigned_to_email,
            });

            for (const userEmail of usersToNotify) {
                if (userEmail && userEmail !== req.user?.email) {
                    await saveNotification(userEmail, statusNotification, oldTicket.ticket_sl);
                    const socketId = connectedUsers?.get(userEmail);
                    if (socketId && io) {
                        io.to(socketId).emit('notification', statusNotification);
                    }
                }
            }
        }

        // Admin remarks are optional guidance sent to every IT User.
        if (
            updates.remarks_by_admin !== undefined &&
            hasChanged(oldTicket.remarks_by_admin, updates.remarks_by_admin) &&
            String(updates.remarks_by_admin || '').trim()
        ) {
            const adminRemark = String(updates.remarks_by_admin).trim();
            const itUsersResult = await pool.request().query(`
                SELECT DISTINCT u.email
                FROM Users u
                INNER JOIN roles r ON u.role_id = r.id
                WHERE r.name IN ('IT User', 'IT Member') AND u.email IS NOT NULL
            `);
            const adminRemarkNotification = {
                type: 'admin_remark',
                title: 'Admin remark added',
                message: `${updatedBy} added a remark for ticket ${oldTicket.ticket_sl}: ${adminRemark}`
            };
            for (const itUser of itUsersResult.recordset) {
                if (!itUser.email || itUser.email === req.user?.email) continue;
                await saveNotification(itUser.email, adminRemarkNotification, oldTicket.ticket_sl);
                const socketId = connectedUsers?.get(itUser.email);
                if (socketId && io) io.to(socketId).emit('notification', adminRemarkNotification);
            }
        }

        // Assignment change notification → notify BOTH the new assignee and the ticket owner
        if (updates.assigned_to_email && oldTicket.assigned_to_email !== updates.assigned_to_email) {
            const newAssigneeInfo = await getUserEmailById(await getUserIdByEmail(updates.assigned_to_email));
            const assignmentNotification = {
                type: 'assignment',
                title: `📌 Ticket Assigned`,
                message: `${updatedBy} assigned ticket ${oldTicket.ticket_sl} to ${newAssigneeInfo?.name || updates.assigned_to_email}`
            };

            const assignmentRecipients = new Set();
            if (updates.assigned_to_email) assignmentRecipients.add(updates.assigned_to_email);   // the assignee
            if (oldTicket.reported_by_email) assignmentRecipients.add(oldTicket.reported_by_email); // the owner

            for (const email of assignmentRecipients) {
                if (!email || email === req.user?.email) continue;   // skip whoever performed the assignment
                await saveNotification(email, assignmentNotification, oldTicket.ticket_sl);
                const socketId = connectedUsers?.get(email);
                if (socketId && io) {
                    io.to(socketId).emit('notification', assignmentNotification);
                }
            }
        }
        if (io) {
            io.emit('ticket-updated', {
                ticket: updatedTicket,
                changes: updates,
                updatedBy: updatedBy,
                timestamp: new Date()
            });

            if (updates.status || updates.risk_label) {
                io.emit('stats-updated', { reason: 'ticket_updated', timestamp: new Date() });
            }
        }

        res.json({
            message: 'Ticket updated successfully',
            ticket: updatedTicket,
            changes: updates,
            audit_summary: changeSummary
        });

    } catch (err) {
        console.error('Update error:', err);
        res.status(500).json({ message: 'Update failed', error: err.message });
    }
};

exports.deleteTicket = async (req, res) => {
    const { id } = req.params;
    const ip_address = getClientIp(req);

    try {
        const pool = await poolPromise;

        // Get ticket data before deletion for audit
        const ticketResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`
                SELECT 
                    t.*,
                    u.name as reportedByName,
                    u.email as reported_by_email,
                    assigned_user.name as assignedToName,
                    assigned_user.email as assigned_to_email
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_id = u.id
                LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
                WHERE t.id = @id
            `);

        if (ticketResult.recordset.length === 0) {
            return res.status(404).json({ message: 'Ticket not found' });
        }

        const ticketToDelete = ticketResult.recordset[0];

        // ✅ AUDIT LOG: Ticket deletion
        await logTicketAction('DELETE', ticketToDelete.ticket_sl, ticketToDelete, null, req, {
            deleted: {
                ticket_sl: ticketToDelete.ticket_sl,
                system_name: ticketToDelete.system_name,
                problem_details: ticketToDelete.problem_details,
                status: ticketToDelete.status
            },
            details: `${req.user.name} deleted ticket ${ticketToDelete.ticket_sl}`,
            ip: ip_address
        });

        // Delete the ticket
        await pool.request()
            .input('id', sql.Int, id)
            .query('DELETE FROM Tickets WHERE id = @id');

        console.log(`✅ Ticket deleted: ${ticketToDelete.ticket_sl} by ${req.user.email} from IP: ${ip_address}`);

        // Emit socket event
        const io = req.app.get('io');
        if (io) {
            io.emit('ticket-deleted', {
                ticket_sl: ticketToDelete.ticket_sl,
                deletedBy: req.user.name,
                timestamp: new Date()
            });
            io.emit('stats-updated', { reason: 'ticket_deleted', timestamp: new Date() });
        }

        res.json({
            success: true,
            message: 'Ticket deleted successfully',
            deletedTicket: {
                ticket_sl: ticketToDelete.ticket_sl,
                system_name: ticketToDelete.system_name
            }
        });

    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ message: 'Delete failed', error: err.message });
    }
};


// exports.deleteTicket = async (req, res) => {
//     const { id } = req.params;
//     try {
//         const pool = await poolPromise;
//         await pool.request().input('id', sql.Int, id).query('DELETE FROM Tickets WHERE id = @id');
//         res.json({ message: 'Ticket deleted successfully' });
//     } catch (err) {
//         console.error(err);
//         res.status(500).json({ message: 'Delete failed' });
//     }
// };

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
                    COALESCE(u.name, t.reporter_name) as reportedByName,
                    COALESCE(assigned_user.name, t.assigned_to_name) as assignedToName,
                    u.email as reported_by_email,
                    assigned_user.email as assigned_to_email
                FROM Tickets t
                LEFT JOIN Users u ON t.reported_by_id = u.id
                LEFT JOIN Users assigned_user ON t.assigned_to_id = assigned_user.id
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

    // Logged-in admin doing the import (used as fallback reporter)
    const adminEmail = req.user.email;
    const adminName = req.user.name;
    const adminId = await getUserIdByEmail(adminEmail);

    const handleEmptyValue = (value) => {
        if (value === undefined || value === null || value === '') return null;
        const s = String(value).trim();
        if (s === '' || s === 'NaN' || s === 'null' || s === 'undefined') return null;
        return s;
    };

    const handleStringField = (value, defaultValue) => {
        if (value === undefined || value === null || value === '') return defaultValue;
        const s = String(value).trim();
        if (s === '' || s === 'NaN' || s === 'null' || s === 'undefined') return defaultValue;
        return s;
    };

    // Resolve a user record (id, email, name) by name
    const getUserByName = async (name) => {
        if (!name || name === 'Unassigned' || name === 'Not Mentioned') return null;
        try {
            const result = await pool.request()
                .input('name', sql.NVarChar, name)
                .query('SELECT id, email, name FROM Users WHERE name = @name');
            return result.recordset[0] || null;
        } catch (err) {
            console.error(`❌ Error resolving user '${name}':`, err.message);
            return null;
        }
    };

    const getStaticItemId = async (tableName, columnName, value) => {
        if (!value || value === 'Not Specified') return null;
        try {
            const result = await pool.request()
                .input('name', sql.NVarChar, value)
                .query(`SELECT id FROM ${tableName} WHERE ${columnName} = @name`);
            return result.recordset[0]?.id || null;
        } catch (err) {
            console.error(`❌ Error checking ${tableName}:`, err.message);
            return null;
        }
    };

    for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];

        try {
            console.log(`\n📝 Processing ticket ${i + 1}/${tickets.length}:`, ticket.ticket_sl || `row_${i + 1}`);

            const providedTicketSl = handleEmptyValue(ticket.ticket_sl);
            const date = handleEmptyValue(ticket.date);
            const month = handleEmptyValue(ticket.month);
            const affected_user = handleStringField(ticket.affected_user, 'Not Mentioned');
            const assigned_to_name_excel = handleStringField(ticket.assigned_to_name, 'Unassigned');
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

            // ── Resolve REPORTER to an ID (fallback: importing admin) ──
            let reportedById = null;
            let reporterName = null;
            if (reporter_name_from_excel) {
                const u = await getUserByName(reporter_name_from_excel);
                if (u) {
                    reportedById = u.id;
                    reporterName = u.name;
                    console.log(`✅ Found reporter: ${reporterName} (id ${reportedById})`);
                } else {
                    console.log(`⚠️ Reporter not found: ${reporter_name_from_excel} → using admin`);
                    reportedById = adminId;
                    reporterName = adminName;
                }
            } else {
                reportedById = adminId;
                reporterName = adminName;
            }

            // ── Resolve ASSIGNEE to an ID (may be unassigned) ──
            let assignedToId = null;
            let assignedToName = assigned_to_name_excel;
            if (assigned_to_name_excel && assigned_to_name_excel !== 'Unassigned') {
                const a = await getUserByName(assigned_to_name_excel);
                if (a) {
                    assignedToId = a.id;
                    assignedToName = a.name;
                    console.log(`✅ Found assignee: ${assignedToName} (id ${assignedToId})`);
                }
            }

            // Required field
            if (!problem_details || problem_details === 'No details provided') {
                results.failed.push({
                    ticket_sl: providedTicketSl || `row_${i + 1}`,
                    reporter: reporterName,
                    error: `Missing required fields: problem_details`
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
            let formattedDate = null, formattedDownTime = null, formattedUpTime = null;
            if (date) { const d = new Date(date); if (!isNaN(d.getTime())) formattedDate = d; }
            if (down_time) { const d = new Date(down_time); if (!isNaN(d.getTime())) formattedDownTime = d; }
            if (up_time) { const d = new Date(up_time); if (!isNaN(d.getTime())) formattedUpTime = d; }

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

            // Optional existence warnings
            const deptExists = await getStaticItemId('Departments', 'name', department);
            const branchExists = await getStaticItemId('Branches', 'name', branch);
            const systemExists = await getStaticItemId('Systems', 'name', system_name);
            if (!deptExists && department !== 'Not Specified') console.log(`⚠️ Department '${department}' not found`);
            if (!branchExists && branch !== 'Not Specified') console.log(`⚠️ Branch '${branch}' not found`);
            if (!systemExists && system_name !== 'Not Specified') console.log(`⚠️ System '${system_name}' not found`);

            // ── Insert with ID columns (matches createTicket), UTC timestamps ──
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
                .input('assigned_to_id', sql.Int, assignedToId)
                .input('assigned_to_name', sql.NVarChar, assignedToName)
                .input('pc_name', sql.NVarChar, pc_name)
                .input('down_time', sql.DateTime, formattedDownTime)
                .input('up_time', sql.DateTime, formattedUpTime)
                .input('resolution', sql.NVarChar, resolution)
                .input('root_cause', sql.NVarChar, root_cause)
                .input('remarks', sql.NVarChar, remarks)
                .input('remarks_by_admin', sql.NVarChar, remarks_by_admin)
                .input('special_instruction', sql.NVarChar, special_instruction)
                .input('reported_by_id', sql.Int, reportedById)
                .input('reporter_name', sql.NVarChar, reporterName)
                .input('status', sql.NVarChar, finalStatus)
                .query(`
                    INSERT INTO Tickets (
                        ticket_sl, date, month, system_name, problem_details,
                        department, branch, risk_label, affected_user,
                        assigned_to_id, assigned_to_name, pc_name, down_time, up_time,
                        resolution, root_cause, remarks, remarks_by_admin, special_instruction,
                        reported_by_id, reporter_name, status, created_at, updated_at
                    )
                    VALUES (
                        @ticket_sl, @date, @month, @system_name, @problem_details,
                        @department, @branch, @risk_label, @affected_user,
                        @assigned_to_id, @assigned_to_name, @pc_name, @down_time, @up_time,
                        @resolution, @root_cause, @remarks, @remarks_by_admin, @special_instruction,
                        @reported_by_id, @reporter_name, @status, GETUTCDATE(), GETUTCDATE()
                    )
                `);

            results.successful.push({
                ticket_sl: finalTicketSl,
                reporter: reporterName,
                assignee: assignedToName,
                system: system_name,
                department,
                branch
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
    const rate = results.total > 0 ? ((results.successful.length / results.total) * 100).toFixed(1) : '0';
    console.log(`📈 Success Rate: ${rate}%`);

    res.status(200).json({
        message: `Bulk import completed: ${results.successful.length} successful, ${results.failed.length} failed`,
        summary: {
            total: results.total,
            successful: results.successful.length,
            failed: results.failed.length,
            success_rate: `${rate}%`
        },
        results
    });
};


// ============================================
// GET TOP 10 SYSTEMS (Most tickets)
// ============================================
// ============================================
// GET TOP SYSTEMS (Using same date logic as dashboard stats)
// ============================================
// ============================================
// GET TOP SYSTEMS
// ============================================
exports.getTopSystems = async (req, res) => {
    try {
        const pool = await poolPromise;
        const { dateFilter = 'all' } = req.query;

        console.log('📊 Fetching top systems with filter:', dateFilter);

        // ============================================
        // USE SAME DATE LOGIC AS DASHBOARD STATS
        // ============================================
        let whereClause = `
            WHERE system_name IS NOT NULL
                AND system_name != ''
                AND system_name != 'Unknown'
                AND date IS NOT NULL
        `;

        const params = {};

        // Apply same date filtering logic
        if (dateFilter !== 'all') {
            const dateRange = getDateRangeForFilter(dateFilter);

            console.log('🔍 Date range:', dateRange);

            if (dateRange.startDate && dateRange.endDate) {
                whereClause += `
                    AND date >= @startDate
                    AND date <= @endDate
                `;

                params.startDate = dateRange.startDate;
                params.endDate = dateRange.endDate;

                console.log('✅ Date WHERE clause added');
            }
        }

        console.log('📝 Final WHERE clause:', whereClause);

        // ============================================
        // CREATE REQUEST WITH PARAMETERS
        // ============================================
        const request = pool.request();

        if (params.startDate) {
            request.input('startDate', sql.Date, params.startDate);
        }

        if (params.endDate) {
            request.input('endDate', sql.Date, params.endDate);
        }

        // ============================================
        // GET TOTAL TICKETS
        // ============================================
        const totalCountQuery = `
            SELECT COUNT(*) as total_tickets
            FROM Tickets
            ${whereClause}
        `;

        const totalResult = await request.query(totalCountQuery);

        const totalTickets =
            totalResult.recordset[0]?.total_tickets || 0;

        console.log(`📊 Total tickets for period: ${totalTickets}`);

        // ============================================
        // GET TOP SYSTEMS
        // ============================================
        const systemsRequest = pool.request();

        // Add params again for second query
        if (params.startDate) {
            systemsRequest.input(
                'startDate',
                sql.Date,
                params.startDate
            );
        }

        if (params.endDate) {
            systemsRequest.input(
                'endDate',
                sql.Date,
                params.endDate
            );
        }

        const topSystemsQuery = `
            SELECT TOP 10
                system_name,
                COUNT(*) as ticket_count
            FROM Tickets
            ${whereClause}
            GROUP BY system_name
            ORDER BY ticket_count DESC
        `;

        const systemsResult =
            await systemsRequest.query(topSystemsQuery);

        const topSystems = systemsResult.recordset;

        // ============================================
        // CALCULATE STATS
        // ============================================
        const stats = {
            totalTickets,
            uniqueSystems: topSystems.length,
            topSystemCount:
                topSystems[0]?.ticket_count || 0,
            topSystemName:
                topSystems[0]?.system_name || 'N/A',
            topSystemPercentage:
                totalTickets > 0
                    ? (
                        ((topSystems[0]?.ticket_count || 0) /
                            totalTickets) *
                        100
                    ).toFixed(1)
                    : 0
        };

        // ============================================
        // ADD PERCENTAGE TO EACH SYSTEM
        // ============================================
        const systemsWithPercentage = topSystems.map(system => ({
            ...system,
            percentage:
                totalTickets > 0
                    ? (
                        (system.ticket_count / totalTickets) *
                        100
                    ).toFixed(1)
                    : 0
        }));

        console.log(
            `✅ Found ${systemsWithPercentage.length} top systems`
        );

        res.json({
            success: true,
            data: {
                systems: systemsWithPercentage,
                totalTickets,
                stats,
                dateFilter,
                period: {
                    startDate: params.startDate || null,
                    endDate: params.endDate || null
                }
            }
        });

    } catch (error) {
        console.error(
            '❌ Error fetching top systems:',
            error
        );

        res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
};
// ============================================
// GET CURRENTLY DOWN ATMs
// ============================================
exports.getDownAtms = async (req, res) => {
    try {
        const pool = await poolPromise;

        console.log('🏧 Fetching currently down ATMs...');

        const query = `
            SELECT 
                t.id,
                t.ticket_sl,
                t.system_name,
                t.branch,
                t.down_time,
                t.problem_details,
                t.status,
                t.risk_label,
                t.assigned_to_name,
                t.reporter_name as reported_by_name,
                t.affected_user,
                t.pc_name,
                DATEDIFF(MINUTE, t.down_time, GETUTCDATE()) as downtime_minutes,
                u.name as assigned_to_name_from_users
            FROM Tickets t
            LEFT JOIN Users u ON t.assigned_to_id = u.id
            WHERE t.status IN ('open', 'in-progress')
                AND (t.system_name LIKE '%ATM%' 
                     OR t.system_name LIKE '%CDM%' 
                     OR t.system_name LIKE '%Kiosk%'
                     OR t.problem_details LIKE '%ATM%'
                     OR t.problem_details LIKE '%CDM%')
            ORDER BY t.down_time DESC
        `;

        const result = await pool.request().query(query);

        // Calculate downtime duration for each ATM
        const downAtms = result.recordset.map(atm => {
            let downTimeDuration = 'Unknown';
            let downtimeHours = 0;

            if (atm.down_time && Number.isFinite(Number(atm.downtime_minutes))) {
                try {
                    const diffMins = Math.max(0, Number(atm.downtime_minutes));
                    const diffHours = Math.floor(diffMins / 60);
                    const diffDays = Math.floor(diffHours / 24);

                    if (diffDays > 0) {
                        downTimeDuration = `${diffDays}d ${diffHours % 24}h`;
                    } else if (diffHours > 0) {
                        downTimeDuration = `${diffHours}h ${diffMins % 60}m`;
                    } else {
                        downTimeDuration = `${diffMins}m`;
                    }
                    downtimeHours = diffHours;
                } catch (e) {
                    console.error('Error calculating downtime:', e);
                }
            }

            // Determine risk color
            let riskColor = 'bg-blue-100 text-blue-700';
            if (atm.risk_label === 'HIGH') riskColor = 'bg-red-100 text-red-700';
            else if (atm.risk_label === 'MEDIUM') riskColor = 'bg-orange-100 text-orange-700';

            return {
                id: atm.id,
                ticket_sl: atm.ticket_sl,
                system_name: atm.system_name || 'Unknown ATM',
                branch: atm.branch || 'Unknown Location',
                down_time: atm.down_time,
                down_time_duration: downTimeDuration,
                downtime_hours: downtimeHours,
                problem_details: atm.problem_details,
                status: atm.status,
                risk_label: atm.risk_label || 'LOW',
                risk_color: riskColor,
                assigned_to_name: atm.assigned_to_name_from_users || atm.assigned_to_name || 'Unassigned',
                reported_by_name: atm.reported_by_name || 'Unknown',
                affected_user: atm.affected_user,
                pc_name: atm.pc_name
            };
        });

        console.log(`🏧 Found ${downAtms.length} down ATMs`);

        res.json(downAtms);
    } catch (error) {
        console.error('Error fetching down ATMs:', error);
        res.status(500).json({ error: 'Internal server error', message: error.message });
    }
};


// ============================================
// EMIT REAL-TIME DASHBOARD UPDATES
// ============================================
async function emitRealtimeDashboardUpdates(io) {
    try {
        const pool = await poolPromise;

        // Fetch top systems
        const topSystemsQuery = `
            SELECT 
                system_name, 
                COUNT(*) as ticket_count
            FROM Tickets
            WHERE system_name IS NOT NULL AND system_name != ''
            GROUP BY system_name
            ORDER BY ticket_count DESC
            LIMIT 10
        `;
        const topSystemsResult = await pool.request().query(topSystemsQuery);

        // Fetch down ATMs
        const downAtmsQuery = `
            SELECT 
                t.id,
                t.ticket_sl,
                t.system_name,
                t.branch,
                t.down_time,
                t.problem_details,
                t.status,
                t.risk_label,
                t.assigned_to_name,
                t.reporter_name as reported_by_name,
                DATEDIFF(MINUTE, t.down_time, GETUTCDATE()) as downtime_minutes
            FROM Tickets t
            WHERE t.status IN ('open', 'in-progress')
                AND (t.system_name LIKE '%ATM%' 
                     OR t.system_name LIKE '%CDM%' 
                     OR t.problem_details LIKE '%ATM%')
            ORDER BY t.down_time DESC
            LIMIT 20
        `;
        const downAtmsResult = await pool.request().query(downAtmsQuery);

        // Calculate downtime for ATMs
        const downAtms = downAtmsResult.recordset.map(atm => {
            let downTimeDuration = 'Unknown';
            if (atm.down_time && Number.isFinite(Number(atm.downtime_minutes))) {
                const diffMins = Math.max(0, Number(atm.downtime_minutes));
                const diffHours = Math.floor(diffMins / 60);
                const diffDays = Math.floor(diffHours / 24);

                if (diffDays > 0) downTimeDuration = `${diffDays}d ${diffHours % 24}h`;
                else if (diffHours > 0) downTimeDuration = `${diffHours}h ${diffMins % 60}m`;
                else downTimeDuration = `${diffMins}m`;
            }
            return { ...atm, down_time_duration: downTimeDuration };
        });

        // Emit updates
        io.emit('top-systems-data', topSystemsResult.recordset);
        io.emit('down-atms-data', downAtms);

        console.log('📡 Emitted real-time dashboard updates');
    } catch (error) {
        console.error('Error emitting real-time updates:', error);
    }
}

// // You can call this function periodically (every 30 seconds) or on demand
// setInterval(() => {
//     const io = require('../server').io; // You'll need to export io from your server
//     if (io) {
//         emitRealtimeDashboardUpdates(io);
//     }
// }, 30000); // Every 30 seconds
