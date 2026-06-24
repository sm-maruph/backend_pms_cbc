const { ad } = require("../config/ldap");

/**
 * Genuine "wrong username/password" (never retry) vs. transient/connection
 * problem (safe to retry). We do NOT flatten the error — the controller's
 * describeAdError() / isTransientError() need the real thing.
 */
function isInvalidCredentials(err) {
    if (!err) return false;
    if (err.code === 49) return true;
    if (err.name === 'InvalidCredentialsError') return true;
    const msg = err.message || '';
    // AD embeds a sub-code in the bind error, e.g. "... data 52e ..."
    return /data (52e|525|530|531|532|533|701|773|775)/i.test(msg);
}

class LDAPService {

    static authenticate(employeeId, password) {
        return new Promise((resolve, reject) => {

            const id = employeeId.trim().toUpperCase();
            const loginId = `${id}@BNGL.CBCSL.AD`;

            console.log("🔐 AD Login:", loginId);

            ad.authenticate(loginId, password, (err, auth) => {

                // CASE A: a real error came back
                if (err) {
                    if (isInvalidCredentials(err)) {
                        const e = new Error(err.message || 'Invalid AD credentials');
                        e.name = 'InvalidCredentialsError';
                        e.code = 49;
                        return reject(e);                     // fail fast (correct)
                    }
                    // transient / connection / DNS / timeout — pass it through INTACT
                    console.warn("⚠️ AD transient bind error:", err.code || err.name || err.message);
                    err.isTransient = true;                   // help the controller classify it
                    return reject(err);                       // retry will kick in
                }

                // CASE B: no error but not authenticated → bad credentials
                if (!auth) {
                    console.log("❌ AD auth returned false");
                    const e = new Error('Invalid AD credentials');
                    e.name = 'InvalidCredentialsError';
                    e.code = 49;
                    return reject(e);
                }

                // STEP 2: SEARCH USER (uses the service-account bind)
                const query = {
                    filter: `(sAMAccountName=${id})`,
                    attributes: [
                        'displayName', 'mail', 'department', 'title',
                        'telephoneNumber', 'employeeID', 'sAMAccountName', 'memberOf'
                    ]
                };

                ad.findUsers(query, (findErr, users) => {
                    if (findErr) {
                        findErr.isTransient = true;           // search after a good bind = transient
                        return reject(findErr);
                    }

                    const user = users?.[0];
                    if (!user) {
                        // Bind succeeded, so the account is real. An empty search is a
                        // directory glitch, NOT bad credentials — make it retryable.
                        const e = new Error('User lookup failed in AD after successful bind');
                        e.isTransient = true;
                        return reject(e);
                    }

                    const employee_id = user.employeeID || user.sAMAccountName || id;
                    const groups = (user.memberOf || []).map(g => {
                        const m = g.match(/CN=([^,]+)/);
                        return m ? m[1] : g;
                    });

                    resolve({
                        authenticated: true,
                        employee_id,
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