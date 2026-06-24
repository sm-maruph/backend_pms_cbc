// routes/ticketRoutes.js
const express    = require('express');
const router     = express.Router();
const auth       = require('../middleware/auth');
const admin      = require('../middleware/admin');
const { validateTicket } = require('../middleware/validation');
 
const {
  getAllTickets, getMyTickets, createTicket, updateTicket, deleteTicket,
  getTicketBySL, validateBulkTickets, bulkImportTickets,
  getPaginatedTickets, getDashboardStats, getTopSystems, getDownAtms,
} = require('../controllers/ticketController');
 
// ── Safe import of permissions middleware ─────────────────────────────────────
let requirePermission, requireAnyPermission, attachPermissions;
try {
  const perms = require('../middleware/permissions');
  requirePermission    = typeof perms.requirePermission    === 'function' ? perms.requirePermission    : null;
  requireAnyPermission = typeof perms.requireAnyPermission === 'function' ? perms.requireAnyPermission : null;
  attachPermissions    = typeof perms.attachPermissions    === 'function' ? perms.attachPermissions    : null;
} catch (e) {
  console.warn('⚠️  permissions middleware not loaded in ticketRoutes:', e.message);
}
 
const perm    = (p)     => requirePermission    ? requirePermission(p)        : admin;
const permAny = (...ps) => requireAnyPermission ? requireAnyPermission(...ps) : auth;
const attach  = attachPermissions || ((req, res, next) => next());
 
// Fallback adminOnly matching your original logic
const adminOnly = (req, res, next) => {
  const adminRoles = ['Super Admin', 'Admin', 'admin'];
  if (req.user && adminRoles.includes(req.user.role)) return next();
  return res.status(403).json({ message: 'Access denied. Admin only.' });
};
 
// ── Apply auth to all routes ──────────────────────────────────────────────────
router.use(auth);
router.use(attach);
 
// ── Dashboard / Stats  (before /:id to avoid param conflict) ─────────────────
router.get('/stats',                    perm('dashboard.view'),                                           getDashboardStats);
router.get('/paginated',                permAny('ticket.view.all','ticket.view.branch','ticket.view.own'), getPaginatedTickets);
router.get('/dashboard/top-systems',    perm('dashboard.view'),                                           getTopSystems);
router.get('/dashboard/down-atms',      perm('dashboard.view'),                                           getDownAtms);
 
// ── Fixed paths  (before /:id) ────────────────────────────────────────────────
router.get('/my',                       getMyTickets);
router.get('/sl/:ticket_sl',            permAny('ticket.view.all','ticket.view.branch','ticket.view.own'), getTicketBySL);
 
// ── Bulk import  (before /:id) ────────────────────────────────────────────────
router.post('/bulk-import/validate',    permAny('ticket.create'), validateBulkTickets);
router.post('/bulk-import',             permAny('ticket.create'), bulkImportTickets);
 
// ── All tickets ───────────────────────────────────────────────────────────────
router.get('/',
  permAny('ticket.view.all', 'ticket.view.branch', 'ticket.view.own'),
  getAllTickets
);
 
// Create — keep your original debug logging + validation
router.post('/',
  perm('ticket.create'),
  (req, res, next) => {
    console.log('🔵 POST /api/tickets - Request received');
    console.log('🔵 Body:', req.body);
    next();
  },
  validateTicket,
  (req, res, next) => { console.log('🟢 Validation passed'); next(); },
  createTicket
);
 
// ── Specific ticket by ID  (LAST — catches /:id) ──────────────────────────────
router.get('/:id',    permAny('ticket.view.all','ticket.view.branch','ticket.view.own'), getTicketBySL);
router.put('/:id',    permAny('ticket.edit','ticket.edit.own'),                          updateTicket);
router.delete('/:id', permAny('ticket.delete','ticket.delete.own'),                     deleteTicket);
 
module.exports = router;
 