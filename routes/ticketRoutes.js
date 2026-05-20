const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    getAllTickets,
    getMyTickets,
    createTicket,
    updateTicket,
    deleteTicket,
    getTicketBySL,
    validateBulkTickets,
    bulkImportTickets,
    getPaginatedTickets,    // ✅ Add this - paginated tickets
    getDashboardStats,      // ✅ Add this - dashboard statistics
    getTopSystems,      // ✅ Add this
    getDownAtms 
} = require('../controllers/ticketController');
const { validateTicket } = require('../middleware/validation');

// ✅ Simple admin check middleware
const adminOnly = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Access denied. Admin only.' });
    }
};

// Apply authentication to all routes
router.use(auth);

// ============================================
// DASHBOARD & PAGINATION ROUTES (NEW)
// ============================================

// Get dashboard statistics (for charts and cards)
// This should be before the /:id route to avoid conflicts
router.get('/stats', getDashboardStats);

// Get paginated tickets with filters (for table)
router.get('/paginated', getPaginatedTickets);

// ============================================
// EXISTING ROUTES
// ============================================

// Get all tickets (admin only or all users - depends on your requirement)
router.get('/', getAllTickets);

// Get my tickets (reported by or assigned to current user)
router.get('/my', getMyTickets);

// Get ticket by SL (moved before /:id to avoid conflicts)
router.get('/sl/:ticket_sl', getTicketBySL);

router.get('/dashboard/top-systems', getTopSystems);
router.get('/dashboard/down-atms', getDownAtms);

// ============================================
// BULK IMPORT ROUTES
// ============================================
router.post('/bulk-import/validate', adminOnly, validateBulkTickets);
router.post('/bulk-import', adminOnly, bulkImportTickets);

// ============================================
// CRUD OPERATIONS
// ============================================

// Create new ticket
router.post('/', (req, res, next) => {
    console.log("🔵 POST /api/tickets - Request received");
    console.log("🔵 Headers:", req.headers);
    console.log("🔵 Body:", req.body);
    next();
}, validateTicket, (req, res, next) => {
    console.log("🟢 Validation passed");
    next();
}, createTicket);

// Update ticket by ID
router.put('/:id', updateTicket);

// Delete ticket by ID (admin only)
router.delete('/:id', adminOnly, deleteTicket);

module.exports = router;