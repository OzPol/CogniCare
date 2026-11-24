BEGIN;
DROP TRIGGER "cognicare_session_audit" ON "Session";
DROP TRIGGER "cognicare_new_account_audit" ON "User";
DROP FUNCTION cognicare_audit_identity();
COMMIT;
