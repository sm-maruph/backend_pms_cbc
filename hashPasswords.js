const bcrypt = require('bcrypt');
const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: { encrypt: false, trustServerCertificate: true }
};

async function hashPasswords() {
    try {
        await sql.connect(config);
        
        // Hash for 'admin123' (admin password)
        const adminHash = await bcrypt.hash('admin123', 10);
        // Hash for 'user123' (user password)
        const userHash = await bcrypt.hash('user123', 10);
        
        await sql.query`UPDATE Users SET password_hash = ${adminHash} WHERE email = 'admin@cbc.com'`;
        await sql.query`UPDATE Users SET password_hash = ${userHash} WHERE email = 'user@cbc.com'`;
        await sql.query`UPDATE Users SET password_hash = ${userHash} WHERE email = 'user2@cbc.com'`;
        
        console.log('Passwords hashed successfully');
    } catch (err) {
        console.error(err);
    } finally {
        sql.close();
    }
}

hashPasswords();