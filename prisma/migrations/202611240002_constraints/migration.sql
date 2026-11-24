BEGIN;

CREATE INDEX "Reminder_pending_by_player_due_id"
  ON "Reminder" ("playerId", "dueAt", "id")
  WHERE "doneAt" IS NULL AND "deletedAt" IS NULL;

CREATE INDEX "Reminder_active_by_player_due_id"
  ON "Reminder" ("playerId", "dueAt", "id")
  WHERE "deletedAt" IS NULL;

ALTER TABLE "PlayerProgress" ADD CONSTRAINT "PlayerProgress_bounds"
  CHECK ("difficulty" BETWEEN 1 AND 4 AND "rounds" >= 0 AND "skill" BETWEEN -2 AND 5);

ALTER TABLE "ActivityResult" ADD CONSTRAINT "ActivityResult_bounds"
  CHECK ("difficulty" BETWEEN 1 AND 4 AND "attempts" BETWEEN 1 AND 120 AND "correct" BETWEEN 0 AND "attempts");

CREATE FUNCTION cognicare_append_only() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN RAISE EXCEPTION 'Audit events are append-only'; END; $$;
CREATE TRIGGER cognicare_audit_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON "AuditEvent"
  FOR EACH STATEMENT EXECUTE FUNCTION cognicare_append_only();

INSERT INTO "Exercise" ("game", "order") VALUES ('MATCH', 1), ('FOCUS', 2), ('ROUTINE', 3), ('PATTERN', 4);

COMMIT;
