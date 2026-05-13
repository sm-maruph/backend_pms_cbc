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
    body('systemName').optional({ nullable: true, checkFalsy: true }).trim(),
    body('department').optional({ nullable: true, checkFalsy: true }).trim(),
    body('branch').optional({ nullable: true, checkFalsy: true }).trim(),
    body('affectedUser').optional({ nullable: true, checkFalsy: true }).trim(),
    body('pcName').optional({ nullable: true, checkFalsy: true }).trim(),
    
    // Allow null, empty string, or valid email
    body('assignedToEmail')
        .optional({ nullable: true, checkFalsy: true })
        .custom(value => {
            if (!value || value === null || value === '') return true;
            return /^\S+@\S+\.\S+$/.test(value);
        })
        .withMessage('Invalid email format for assignment'),
    
    body('assignedToName').optional({ nullable: true, checkFalsy: true }).trim(),

    // Risk label with default
    body('riskLabel').optional({ nullable: true }).isIn(['LOW', 'MEDIUM', 'HIGH']).withMessage('Risk label must be LOW, MEDIUM, or HIGH'),

    // Date fields
    body('date').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
    body('downTime').optional({ nullable: true }), // No ISO validation

    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            console.log("❌ Validation errors:", JSON.stringify(errors.array(), null, 2));
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