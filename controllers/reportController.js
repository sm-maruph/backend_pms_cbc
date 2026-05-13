const { poolPromise, sql } = require('../config/db');

exports.getReportData = async (req, res) => {
    const { range, startDate, endDate } = req.query;
    
    try {
        const pool = await poolPromise;
        
        // Build date filter based on range
        let dateFilter = "";
        const params = {};
        
        const now = new Date();
        let start = new Date();
        
        switch (range) {
            case 'daily':
                start.setHours(0, 0, 0, 0);
                dateFilter = "AND t.created_at >= @startDate";
                params.startDate = start;
                break;
            case 'weekly':
                start.setDate(now.getDate() - 7);
                dateFilter = "AND t.created_at >= @startDate";
                params.startDate = start;
                break;
            case 'monthly':
                start.setMonth(now.getMonth() - 1);
                dateFilter = "AND t.created_at >= @startDate";
                params.startDate = start;
                break;
            case 'quarterly':
                start.setMonth(now.getMonth() - 3);
                dateFilter = "AND t.created_at >= @startDate";
                params.startDate = start;
                break;
            case 'yearly':
                start.setFullYear(now.getFullYear() - 1);
                dateFilter = "AND t.created_at >= @startDate";
                params.startDate = start;
                break;
            case 'custom':
                if (startDate && endDate) {
                    dateFilter = "AND t.created_at >= @startDate AND t.created_at <= @endDate";
                    params.startDate = new Date(startDate);
                    params.endDate = new Date(endDate);
                }
                break;
            default:
                // Default to last 30 days
                start.setDate(now.getDate() - 30);
                dateFilter = "AND t.created_at >= @startDate";
                params.startDate = start;
        }
        
        // Build the query
        let query = `
            SELECT 
                t.id,
                t.ticket_sl,
                t.date,
                t.month,
                t.reported_by_email,
                reporter.name as reportedByName,
                t.assigned_to_email,
                assignee.name as assigned_to_name,
                t.affected_user,
                t.system_name,
                t.problem_details,
                t.department,
                t.branch,
                t.risk_label,
                t.pc_name,
                t.down_time,
                t.up_time,
                t.resolution,
                t.root_cause,
                t.remarks,
                t.remarks_by_admin,
                t.special_instruction,
                t.status,
                t.created_at,
                t.updated_at,
                t.reporter_name
            FROM Tickets t
            LEFT JOIN Users reporter ON t.reported_by_email = reporter.email
            LEFT JOIN Users assignee ON t.assigned_to_email = assignee.email
            WHERE 1=1
            ${dateFilter}
            ORDER BY t.created_at DESC
        `;
        
        const request = pool.request();
        
        // Add parameters
        Object.keys(params).forEach(key => {
            request.input(key, sql.DateTime, params[key]);
        });
        
        const result = await request.query(query);
        
        // Calculate summary statistics
        const tickets = result.recordset;
        
        const totalTickets = tickets.length;
        const resolvedTickets = tickets.filter(t => t.status === 'resolved').length;
        const openTickets = tickets.filter(t => t.status === 'open').length;
        const inProgressTickets = tickets.filter(t => t.status === 'in-progress').length;
        const highRiskTickets = tickets.filter(t => t.risk_label === 'HIGH').length;
        const resolutionRate = totalTickets > 0 ? ((resolvedTickets / totalTickets) * 100).toFixed(1) : 0;
        
        // Calculate average response time (time between created_at and first update)
        let totalResponseHours = 0;
        let ticketsWithResponse = 0;
        
        tickets.forEach(ticket => {
            if (ticket.created_at && ticket.updated_at) {
                const responseHours = (new Date(ticket.updated_at) - new Date(ticket.created_at)) / (1000 * 60 * 60);
                if (responseHours > 0) {
                    totalResponseHours += responseHours;
                    ticketsWithResponse++;
                }
            }
        });
        
        const avgResponseTime = ticketsWithResponse > 0 
            ? `${(totalResponseHours / ticketsWithResponse).toFixed(1)}h` 
            : 'N/A';
        
        // Calculate average resolution time (for resolved tickets)
        let totalResolutionHours = 0;
        let resolvedWithTime = 0;
        
        tickets.forEach(ticket => {
            if (ticket.status === 'resolved' && ticket.created_at && ticket.up_time) {
                const resolutionHours = (new Date(ticket.up_time) - new Date(ticket.created_at)) / (1000 * 60 * 60);
                if (resolutionHours > 0) {
                    totalResolutionHours += resolutionHours;
                    resolvedWithTime++;
                }
            }
        });
        
        const avgResolutionTime = resolvedWithTime > 0 
            ? `${(totalResolutionHours / resolvedWithTime).toFixed(1)}h` 
            : 'N/A';
        
        // Calculate satisfaction rate (mock - can be updated with actual feedback data)
        const satisfactionRate = resolvedTickets > 0 ? '85%' : 'N/A';
        
        res.json({
            tickets: tickets,
            summary: {
                totalTickets,
                resolvedTickets,
                openTickets,
                inProgressTickets,
                highRiskTickets,
                resolutionRate: parseFloat(resolutionRate),
                avgResponseTime,
                avgResolutionTime,
                satisfactionRate,
            },
            startDate: params.startDate || null,
            endDate: params.endDate || null,
        });
        
    } catch (err) {
        console.error('Error fetching report data:', err);
        res.status(500).json({ message: 'Error fetching report data', error: err.message });
    }
};