const ActiveDirectory = require("activedirectory2");

const ad = new ActiveDirectory({
    url: "ldap://BNGL.CBCSL.AD:389",
    baseDN: "dc=BNGL,dc=CBCSL,dc=AD",
    username: "BD06608@BNGL.CBCSL.AD",
    password: "abcd@2828"
});

ad.findUser("BD06653", (err, user) => {
    console.log("ERROR:", err);
    console.log("USER:", user);
});