const { ad } = require("../config/ldap");

class LDAPService {

    static authenticate(employeeId, password) {
        return new Promise((resolve, reject) => {

            const id = employeeId.trim().toUpperCase();

            const loginId = `${id}@BNGL.CBCSL.AD`;

            console.log("🔐 AD Login:", loginId);

            // STEP 1: AUTHENTICATE
            ad.authenticate(loginId, password, (err, auth) => {

                if (err || !auth) {
                    console.log("❌ AD auth failed");
                    return reject(new Error("Invalid AD credentials"));
                }

                // STEP 2: SEARCH USER
                const query = {
                    filter: `(sAMAccountName=${id})`,
                    attributes: [
                        'displayName',
                        'mail',
                        'department',
                        'title',
                        'telephoneNumber',
                        'employeeID',
                        'sAMAccountName',
                        'memberOf'
                    ]
                };

                ad.findUsers(query, (findErr, users) => {

                    if (findErr) {
                        return reject(findErr);
                    }

                    const user = users?.[0];

                    if (!user) {
                        return reject(new Error("User not found in AD"));
                    }

                    // STEP 3: EXTRACT EMPLOYEE ID (IMPORTANT PART)
                    const employee_id =
                        user.employeeID ||
                        user.sAMAccountName ||
                        id;

                    // STEP 4: CLEAN GROUPS
                    const groups = (user.memberOf || []).map(g => {
                        const match = g.match(/CN=([^,]+)/);
                        return match ? match[1] : g;
                    });

                    resolve({
                        authenticated: true,

                        employee_id,   // 👈 THIS is what you need for DB mapping

                        name: user.displayName || id,
                        email: user.mail || '',
                        department: user.department || '',
                        title: user.title || '',
                        phone: user.telephoneNumber || '',
                        groups
                    });
                });
            });
        });
    }
}

module.exports = LDAPService;