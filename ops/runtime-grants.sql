\set ON_ERROR_STOP on

GRANT CONNECT ON DATABASE cognicare TO cognicare_app;
GRANT USAGE ON SCHEMA public TO cognicare_app;
GRANT SELECT ON TABLE "User" TO cognicare_app;
GRANT INSERT ("id", "name", "email", "emailVerified", "image", "createdAt", "updatedAt") ON TABLE "User" TO cognicare_app;
GRANT UPDATE ("name", "email", "emailVerified", "image", "updatedAt") ON TABLE "User" TO cognicare_app;
GRANT SELECT, INSERT, UPDATE ON TABLE
  "Authenticator", "RecoveryCode", "PlayerProgress", "Reminder",
  "CareInvitation", "CareLink", "IdempotencyReceipt", "DailyActivity", "PracticeJob"
TO cognicare_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "Session", "Account", "Verification" TO cognicare_app;
GRANT SELECT ON TABLE "Exercise" TO cognicare_app;
GRANT SELECT, INSERT ON TABLE "ActivityResult", "AuditEvent" TO cognicare_app;
GRANT USAGE, SELECT ON SEQUENCE "AuditEvent_id_seq" TO cognicare_app;
