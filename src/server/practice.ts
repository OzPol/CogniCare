import { randomUUID } from "node:crypto";
import { planOutput, practiceInput, type PracticeInput, type PracticeView } from "@/shared/domain";
import type { AIConnector } from "./ai";
import { requireCareRole, type Actor } from "./auth";
import { practiceEnabled } from "./config";
import { database } from "./db";
import { ApiError } from "./http";
import { audit, mutate } from "./mutation";

const maxAttempts = 3;
const leaseDuration = 45_000;

export function checkPractice(current: Actor) {
  requireCareRole(current);
  if (!practiceEnabled()) throw new ApiError(404, "plans_disabled");
}

export function queuePlan(current: Actor, correlation: string, key: string, input: PracticeInput) {
  checkPractice(current);
  return mutate(current.userId, "practice.queue", key, input, async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(214627, 502)::text`;
    const active = { in: ["QUEUED", "RUNNING"] as ("QUEUED" | "RUNNING")[] };
    const [pending, own] = await Promise.all([
      tx.practiceJob.count({ where: { state: active } }),
      tx.practiceJob.count({ where: { state: active, ownerId: current.userId } }),
    ]);
    if (pending >= 100 || own >= 3) throw new ApiError(429, "plans_busy", 15);
    const row = await tx.practiceJob.create({
      data: { ownerId: current.userId, template: input.template }, select: { id: true },
    });
    await audit(tx, current.userId, correlation, "practice.queued", row.id, undefined, { state: "QUEUED" });
    return { status: 202, body: { id: row.id } };
  });
}

export async function readPlan(current: Actor, id: string): Promise<PracticeView> {
  checkPractice(current);
  const result = await database().practiceJob.findFirst({
    where: { id, ownerId: current.userId },
    select: { id: true, state: true, result: true },
  });
  if (!result) throw new ApiError(404, "not_found");
  return { id, state: result.state, result: result.result ? planOutput.parse(result.result) : null };
}

type Claimed = { id: string; template: string; ownerId: string; attempts: number };

export async function processPlan(connector: AIConnector) {
  const now = new Date();
  const correlation = randomUUID();
  const lease = randomUUID();
  const claimed = await database().$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Claimed[]>`
      WITH next_job AS (
        SELECT "id" FROM "PracticeJob"
        WHERE "state" IN ('QUEUED', 'RUNNING') AND "availableAt" <= ${now}
        ORDER BY "availableAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      UPDATE "PracticeJob" AS job SET
        "state" = CASE WHEN job."attempts" >= ${maxAttempts} THEN 'FAILED'::"JobState" ELSE 'RUNNING'::"JobState" END,
        "attempts" = job."attempts" + 1,
        "lease" = ${lease}::uuid, "availableAt" = ${new Date(now.getTime() + leaseDuration)}, "updatedAt" = ${now}
      FROM next_job WHERE job."id" = next_job."id"
      RETURNING job."id", job."template", job."ownerId", job."attempts"
    `;
    const job = rows[0];
    if (job) await audit(tx, "worker:practice", correlation,
      job.attempts > maxAttempts ? "practice.failed" : "practice.claimed", job.id,
      undefined, { attempts: job.attempts });
    return job;
  });
  if (!claimed) return false;
  if (claimed.attempts > maxAttempts) return true;

  const input = practiceInput.parse({ template: claimed.template });
  const result = planOutput.parse(await connector.suggest(input));
  await database().$transaction(async (tx) => {
    const completed = await tx.practiceJob.updateMany({
      where: { id: claimed.id, state: "RUNNING", lease },
      data: { state: "DONE", lease: null, result },
    });
    if (completed.count) await audit(tx, "worker:practice", correlation, "practice.completed", claimed.id,
      { state: "RUNNING" }, { state: "DONE" });
  });
  return true;
}
