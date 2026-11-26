import { createHash, createHmac } from "node:crypto";
import type { CareSummary } from "@/shared/domain";
import { requireCareRole, type Actor } from "./auth";
import { secret } from "./config";
import { database, type Tx } from "./db";
import { ApiError, guardedLimit } from "./http";
import { audit, mutate } from "./mutation";
import { reminderView } from "./reminders";

function inviteCode(userId: string, key: string) {
  return createHmac("sha256", secret("AUTH_SECRET")).update("invite-v1:" + userId + ":" + key)
    .digest().subarray(0, 18).toString("base64url");
}
const digest = (code: string) => createHash("sha256").update(code).digest("hex");

async function lockConsent(tx: Tx, patientId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${patientId} FOR UPDATE`;
}

export async function careList(current: Actor) {
  if (current.role === "PLAYER") {
    const rows = await database().careLink.findMany({
      where: { patientId: current.userId, revokedAt: null }, take: 50,
      orderBy: { grantedAt: "desc" }, select: { caregiver: { select: { id: true, name: true } } },
    });
    return { people: rows.map(({ caregiver }) => caregiver) };
  }
  const rows = await database().careLink.findMany({
    where: { caregiverId: current.userId, revokedAt: null }, take: 50,
    orderBy: { grantedAt: "desc" }, select: { patient: { select: { id: true, name: true } } },
  });
  return { people: rows.map(({ patient }) => patient) };
}

export async function invite(current: Actor, correlation: string, key: string) {
  if (current.role !== "PLAYER") throw new ApiError(403, "access_denied");
  const code = inviteCode(current.userId, key);
  const receipt = await mutate(current.userId, "care.invite", key, {}, async (tx) => {
    const now = new Date();
    await lockConsent(tx, current.userId);
    const active = await tx.careInvitation.count({
      where: { patientId: current.userId, consumedAt: null, expiresAt: { gt: now } },
    });
    if (active >= 5) throw new ApiError(429, "too_many_invites", 60);
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60_000);
    const row = await tx.careInvitation.create({
      data: { patientId: current.userId, digest: digest(code), expiresAt }, select: { id: true },
    });
    await audit(tx, current.userId, correlation, "care.invited", row.id, undefined, { expiresAt: expiresAt.toISOString() });
    return { status: 201, body: { expiresAt: expiresAt.toISOString() } };
  });
  return { status: receipt.status, body: { ...receipt.body, code } };
}

export async function acceptInvite(current: Actor, correlation: string, key: string, code: string) {
  requireCareRole(current);
  await guardedLimit("care-invite:" + current.userId, 12, 60_000);
  const identifier = digest(code);
  return mutate(current.userId, "care.accept", key, { digest: identifier }, async (tx) => {
    const row = await tx.careInvitation.findUnique({ where: { digest: identifier } });
    if (!row || row.patientId === current.userId) throw new ApiError(404, "invite_unavailable");
    const patientId = row.patientId;
    await lockConsent(tx, patientId);
    const now = new Date();
    const taken = await tx.careInvitation.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now },
    });
    if (taken.count !== 1) throw new ApiError(404, "invite_unavailable");
    const caregiverId = current.userId;
    const where = { patientId_caregiverId: { patientId, caregiverId } };
    const before = await tx.careLink.findUnique({ where, select: { revokedAt: true } });
    await tx.careLink.upsert({
      where,
      create: { patientId, caregiverId, grantedAt: now },
      update: { revokedAt: null, grantedAt: now },
    });
    await audit(tx, caregiverId, correlation, "care.access_granted", row.id,
      { active: !!before && !before.revokedAt }, { active: true, patientId, caregiverId });
    return { status: 200, body: { patientId } };
  });
}

export function revoke(current: Actor, correlation: string, key: string, caregiverId: string) {
  if (current.role !== "PLAYER") throw new ApiError(403, "access_denied");
  return mutate(current.userId, "care.revoke", key, { caregiverId }, async (tx) => {
    const patientId = current.userId;
    await lockConsent(tx, patientId);
    const now = new Date();
    const changed = await tx.careLink.updateMany({
      where: { patientId, caregiverId, revokedAt: null }, data: { revokedAt: now },
    });
    if (!changed.count) throw new ApiError(404, "not_found");
    const expired = await tx.careInvitation.updateMany({
      where: { patientId, consumedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now },
    });
    await audit(tx, patientId, correlation, "care.access_revoked", caregiverId,
      { active: true }, { active: false, invitationsExpired: expired.count });
    return { status: 200, body: { revoked: true } };
  });
}

export async function careSummary(current: Actor, patientId: string): Promise<CareSummary> {
  requireCareRole(current);
  return database().$transaction(async (tx) => {
    const link = await tx.careLink.findFirst({
      where: { patientId, caregiverId: current.userId, revokedAt: null }, select: { patientId: true },
    });
    if (!link) throw new ApiError(404, "not_found");
    const now = new Date();
    const from = new Date(now);
    from.setUTCHours(0, 0, 0, 0);
    from.setUTCDate(from.getUTCDate() - 6);
    const overdueFilter = { playerId: patientId, dueAt: { lt: now }, doneAt: null, deletedAt: null };
    const [days, recent, overdue, overdueCount] = await Promise.all([
      tx.dailyActivity.findMany({
        where: { playerId: patientId, day: { gte: from } }, select: { day: true, game: true, rounds: true, correct: true, attempts: true },
      }),
      tx.activityResult.findFirst({
        where: { playerId: patientId }, orderBy: [{ playedAt: "desc" }, { id: "desc" }], select: { playedAt: true },
      }),
      tx.reminder.findMany({ where: overdueFilter, orderBy: [{ dueAt: "desc" }, { id: "desc" }], take: 10 }),
      tx.reminder.count({ where: overdueFilter }),
    ]);
    const perGame = new Map<CareSummary["activities"][number]["game"], CareSummary["activities"][number]>();
    const perDay = new Map<string, number>();
    let rounds = 0;
    for (const { day, game, rounds: amount, correct, attempts } of days) {
      const name = day.toISOString().slice(0, 10);
      const prior = perGame.get(game) ?? { game, rounds: 0, correct: 0, attempts: 0 };
      perGame.set(game, { game, rounds: prior.rounds + amount, correct: prior.correct + correct, attempts: prior.attempts + attempts });
      perDay.set(name, (perDay.get(name) ?? 0) + amount);
      rounds += amount;
    }
    return {
      rounds, lastPlayedAt: recent?.playedAt.toISOString() ?? null, overdue: overdue.map(reminderView), overdueCount,
      activities: [...perGame.values()],
      days: Array.from({ length: 7 }, (_, index) => {
        const day = new Date(from.getTime() + index * 86_400_000).toISOString().slice(0, 10);
        return { day, rounds: perDay.get(day) ?? 0 };
      }),
    };
  }, { isolationLevel: "RepeatableRead" });
}
