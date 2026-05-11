const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getAllTickets, getMyTickets, createTicket, updateTicket, deleteTicket } = require('../controllers/ticketController');
const { validateTicket } = require('../middleware/validation');

console.log('ticketRoutes loaded'); // debug (remove later)
router.use(auth);
router.get('/', getAllTickets);
router.get('/my', getMyTickets);
router.post('/', validateTicket, createTicket);
router.put('/:id', updateTicket);
router.delete('/:id', deleteTicket);
module.exports = router;
