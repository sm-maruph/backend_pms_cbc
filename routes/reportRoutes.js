const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { getReportData } = require('../controllers/reportController');

router.get('/', auth, getReportData);
module.exports = router;
