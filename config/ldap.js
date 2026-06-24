const ActiveDirectory = require("activedirectory2");

const config = {
    url: `ldap://${process.env.LDAP_HOST}:${process.env.LDAP_PORT}`,
    baseDN: process.env.LDAP_BASE_DN,
    username: process.env.LDAP_USERNAME,
    password: process.env.LDAP_PASSWORD,

    // these matter for your intermittent failures
    connectTimeout: Number(process.env.LDAP_TIMEOUT) || 10000,
    timeout:        Number(process.env.LDAP_TIMEOUT) || 10000,
    idleTimeout:    15000,
    reconnect:      true,   // recover from connections the DC dropped while idle

    attributes: {
        user: [
            "displayName", "mail", "department", "title",
            "telephoneNumber", "employeeID", "sAMAccountName", "memberOf"
        ]
    }
};

const ad = new ActiveDirectory(config);

module.exports = { ad };