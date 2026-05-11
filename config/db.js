const sql = require('mssql');

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: false,               // set to true if using Azure
        trustServerCertificate: true  // for self-signed certs (dev only)
    }
};

let poolPromise;
try {
    poolPromise = new sql.ConnectionPool(config)
        .connect()
        .then(pool => {
            console.log('✅ Connected to SQL Server');
            return pool;
        })
        .catch(err => {
            console.error('❌ Database Connection Failed:', err.message);
            // Return a rejected promise that will be caught later
            return Promise.reject(err);
        });
} catch (err) {
    console.error('❌ Database Connection Error:', err.message);
    poolPromise = Promise.reject(err);
}

module.exports = { poolPromise, sql };

module.exports = { sql, poolPromise };