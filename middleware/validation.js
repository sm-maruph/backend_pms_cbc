const { body, validationResult } = require('express-validator');

const validateLogin = [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

const validateTicket = [
    // Required fields (only problemDetails is truly required)
    body('problemDetails').notEmpty().trim().withMessage('Problem details are required'),

    // Optional fields with validation when provided
    body('systemName').optional().trim(),
    body('department').optional().trim(),
    body('branch').optional().trim(),
    body('affectedUser').optional().trim(),
    body('pcName').optional().trim(),
    body('assignedToEmail').optional().isEmail().withMessage('Invalid email format for assignment'),
    body('assignedToName').optional().trim(),  // ✅ ADD THIS - important!

    // Risk label with default (not required in request, will default to MEDIUM)
    body('riskLabel').optional().isIn(['LOW', 'MEDIUM', 'HIGH']).withMessage('Risk label must be LOW, MEDIUM, or HIGH'),

    // Date fields (optional, will default to current date/time)
    body('date').optional().isISO8601().withMessage('Invalid date format'),
    body('downTime').optional(), // ✅ REMOVED ISO validation - now accepts any format

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

// New validation for ticket update (more permissive)
const validateTicketUpdate = [
    body('status').optional().isIn(['open', 'in-progress', 'resolved']).withMessage('Invalid status'),
    body('risk_label').optional().isIn(['LOW', 'MEDIUM', 'HIGH']).withMessage('Invalid risk level'),
    body('assigned_to_email').optional().isEmail().withMessage('Invalid email format'),
    body('assigned_to_name').optional().trim(),
    body('system_name').optional().trim(),
    body('department').optional().trim(),
    body('branch').optional().trim(),
    body('affected_user').optional().trim(),
    body('pc_name').optional().trim(),
    body('problem_details').optional().trim(),
    body('root_cause').optional().trim(),
    body('resolution').optional().trim(),
    body('remarks').optional().trim(),
    body('remarks_by_admin').optional().trim(),
    body('up_time').optional(),
    body('down_time').optional(),
];

module.exports = { validateLogin, validateTicket, validateTicketUpdate };