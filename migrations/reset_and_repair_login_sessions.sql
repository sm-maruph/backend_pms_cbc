SET XACT_ABORT ON;
BEGIN TRANSACTION;

IF COL_LENGTH('UserSessions', 'expires_at') IS NULL
    ALTER TABLE UserSessions ADD expires_at DATETIME NULL;
IF COL_LENGTH('UserSessions', 'renewed_at') IS NULL
    ALTER TABLE UserSessions ADD renewed_at DATETIME NULL;
IF COL_LENGTH('UserSessions', 'renewal_count') IS NULL
    ALTER TABLE UserSessions ADD renewal_count INT NOT NULL CONSTRAINT DF_UserSessions_renewal_count DEFAULT 0;
IF COL_LENGTH('UserSessions', 'session_status') IS NULL
    ALTER TABLE UserSessions ADD session_status VARCHAR(20) NOT NULL CONSTRAINT DF_UserSessions_status DEFAULT 'ACTIVE';
IF COL_LENGTH('UserSessions', 'end_reason') IS NULL
    ALTER TABLE UserSessions ADD end_reason VARCHAR(40) NULL;

DELETE FROM UserSessions;
DELETE FROM audit_logs
WHERE action_type IN ('LOGIN', 'LOGOUT', 'RENEW')
   OR entity_type = 'SESSION';

UPDATE Users
SET last_login = NULL,
    last_logout = NULL,
    last_activity_at = NULL,
    login_count = 0,
    total_active_seconds = 0,
    is_online = 0;

COMMIT TRANSACTION;

SELECT COUNT(*) AS remaining_sessions FROM UserSessions;
SELECT COUNT(*) AS online_users FROM Users WHERE is_online = 1;
