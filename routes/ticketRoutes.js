const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { 
    getAllTickets, 
    getMyTickets, 
    createTicket, 
    updateTicket, 
    deleteTicket,
    getTicketBySL  // Add this new function
} = require('../controllers/ticketController');
const { validateTicket } = require('../middleware/validation');

router.use(auth);

// Get all tickets (admin only or all users - depends on your requirement)
router.get('/', getAllTickets);

// Get my tickets (reported by or assigned to current user)
router.get('/my', getMyTickets);

// Get ticket by ticket_sl (e.g., /api/tickets/sl/13052026-1)
router.get('/sl/:ticket_sl', getTicketBySL);

// Create new ticket
router.post('/', validateTicket, createTicket);

// Update ticket by ID
router.put('/:id', updateTicket);

// Delete ticket by ID (admin only - you might want to add admin check)
router.delete('/:id', deleteTicket);

module.exports = router;