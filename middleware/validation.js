const { body, validationResult } = require('express-validator');

const validateLogin = [
    body('email').isEmail(),
    body('password').notEmpty(),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        next();
    }
];

const validateTicket = [
    body('systemName').notEmpty().trim(),
    body('problemDetails').notEmpty().trim(),
    body('department').notEmpty(),
    body('branch').notEmpty(),
    body('riskLabel').isIn(['LOW', 'MEDIUM', 'HIGH']),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
        next();
    }
];

module.exports = { validateLogin, validateTicket };
