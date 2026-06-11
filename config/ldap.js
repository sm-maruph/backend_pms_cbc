const ActiveDirectory = require("activedirectory2");

const config = {
    url: `ldap://${process.env.LDAP_HOST}:${process.env.LDAP_PORT}`,
    baseDN: process.env.LDAP_BASE_DN,

    username: process.env.LDAP_USERNAME, // service account
    password: process.env.LDAP_PASSWORD,

    attributes: {
        user: [
            "displayName",
            "mail",
            "department",
            "title",
            "telephoneNumber",
            "sAMAccountName",
            "memberOf"
        ]
    }
};

const ad = new ActiveDirectory(config);

module.exports = { ad };