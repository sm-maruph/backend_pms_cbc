const express = require('express');
const router = express.Router();
const { login, logout } = require('../controllers/authController');
const authenticateToken = require('../middleware/auth');

const { validateLogin } = require('../middleware/validation');
const LDAPService = require('../services/ldapService');

router.post('/login', validateLogin, login);
router.post('/logout', authenticateToken, logout);



// Temporary AD test route
router.post("/ad-test", async (req, res) => {
    try {
        const result = await LDAPService.authenticate(
            req.body.employee_id,
            req.body.password
        );

        res.json({
            success: true,
            data: result
        });

    } catch (err) {
        res.status(401).json({
            success: false,
            error: err.message
        });
    }
});


router.post('/ad-direct-test', async (req, res) => {
    const ad = require('../config/ldap');

    const username = `${req.body.employee_id}@BNGL.CBCSL.AD`;

    console.log("TESTING:", username);

    ad.authenticate(username, req.body.password, (err, auth) => {
        console.log("ERR:", err);
        console.log("AUTH:", auth);

        res.json({
            err: err?.message,
            auth
        });
    });
});

module.exports = router;