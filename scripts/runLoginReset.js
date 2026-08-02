require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { poolPromise } = require('../config/db');

async function run() {
    const migrationPath = path.join(__dirname, '..', 'migrations', 'reset_and_repair_login_sessions.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    const pool = await poolPromise;
    const result = await pool.request().batch(migration);
    const summaries = result.recordsets || [];
    console.log(JSON.stringify({
        remaining_sessions: summaries[0]?.[0]?.remaining_sessions ?? null,
        online_users: summaries[1]?.[0]?.online_users ?? null
    }));
    await pool.close();
}

run().catch(error => {
    console.error(`Login reset failed: ${error.message}`);
    process.exitCode = 1;
});
