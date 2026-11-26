-- Run only after bringing down the release that depends on these objects.
BEGIN;
DROP TRIGGER "cognicare_audit_immutable" ON "AuditEvent";
DROP FUNCTION cognicare_append_only();
ALTER TABLE "ActivityResult" DROP CONSTRAINT "ActivityResult_bounds";
ALTER TABLE "PlayerProgress" DROP CONSTRAINT "PlayerProgress_bounds";
DROP INDEX "Reminder_active_by_player_due_id";
DROP INDEX "Reminder_pending_by_player_due_id";
COMMIT;
