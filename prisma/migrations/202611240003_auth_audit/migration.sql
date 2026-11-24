BEGIN;

CREATE FUNCTION cognicare_audit_identity() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'User' THEN
    INSERT INTO "AuditEvent" ("actorId", "action", "entityId", "after", "correlationId")
    VALUES (NEW."id", 'account.created', NEW."id", jsonb_build_object('role', NEW."role"), gen_random_uuid());
  ELSIF TG_OP = 'INSERT' THEN
    INSERT INTO "AuditEvent" ("actorId", "action", "entityId", "after", "correlationId")
    VALUES (NEW."userId", 'session.opened', NEW."id", '{"active":true}'::jsonb, gen_random_uuid());
  ELSE
    INSERT INTO "AuditEvent" ("actorId", "action", "entityId", "before", "after", "correlationId")
    VALUES (OLD."userId", 'session.ended', OLD."id", '{"active":true}'::jsonb, '{"active":false}'::jsonb, gen_random_uuid());
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER cognicare_new_account_audit AFTER INSERT ON "User"
FOR EACH ROW EXECUTE FUNCTION cognicare_audit_identity();

CREATE TRIGGER cognicare_session_audit AFTER INSERT OR DELETE ON "Session"
FOR EACH ROW EXECUTE FUNCTION cognicare_audit_identity();

COMMIT;
