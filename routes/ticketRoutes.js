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
    validateBulkTickets,    // ✅ Add this
    bulkImportTickets    // Add this new function
} = require('../controllers/ticketController');
const { validateTicket } = require('../middleware/validation');

// ✅ Simple admin check middleware (add this here)
const adminOnly = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ message: 'Access denied. Admin only.' });
    }
};

router.use(auth);

// Get all tickets (admin only or all users - depends on your requirement)
router.get('/', getAllTickets);

// Get my tickets (reported by or assigned to current user)
router.get('/my', getMyTickets);

// ✅ BULK IMPORT ROUTES - Fixed (no protect, use adminOnly)
router.post('/bulk-import/validate', adminOnly, validateBulkTickets);
router.post('/bulk-import', adminOnly, bulkImportTickets);


// Create new ticket
// Add debug logging for POST
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

// Delete ticket by ID (admin only - you might want to add admin check)
router.delete('/:id', deleteTicket);

module.exports = router;