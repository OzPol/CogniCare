import { z } from "zod";
import type { Reminder } from "@/generated/prisma/client";
import { idSchema, reminderDraft, reminderUpdate, type ReminderView } from "@/shared/domain";
import type { Actor } from "./auth";
import { database } from "./db";
import { ApiError } from "./http";
import { audit, mutate } from "./mutation";

const cursorSchema = z.tuple([z.iso.datetime(), idSchema]);
const pageSize = 20;

export function reminderView(record: Reminder): ReminderView {
  return {
    id: record.id, kind: record.kind, title: record.title,
    dueAt: record.dueAt.toISOString(), doneAt: record.doneAt?.toISOString() ?? null, version: record.version,
  };
}

export async function hasDueReminder(playerId: string) {
  return !!(await database().reminder.findFirst({
    where: { playerId, deletedAt: null, doneAt: null, dueAt: { lte: new Date() } },
    select: { id: true },
  }));
}

export async function listReminders(playerId: string, cursor: string | null) {
  if (cursor && cursor.length > 160) throw new ApiError(400, "invalid_cursor");
  let edge: z.infer<typeof cursorSchema> | undefined;
  if (cursor) {
    try {
      edge = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    } catch {
      throw new ApiError(400, "invalid_cursor");
    }
  }
  const records = await database().reminder.findMany({
    where: {
      playerId, deletedAt: null,
      ...(edge ? { OR: [
        { dueAt: { gt: new Date(edge[0]) } },
        { dueAt: new Date(edge[0]), id: { gt: edge[1] } },
      ] } : {}),
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: pageSize + 1,
  });
  const items = records.slice(0, pageSize).map(reminderView);
  const last = items.at(-1);
  const next = records.length > pageSize && last
    ? Buffer.from(JSON.stringify([last.dueAt, last.id])).toString("base64url")
    : null;
  return { items, next };
}

function date(value: string) {
  const dueAt = new Date(value);
  if (dueAt.getTime() < Date.now() - 86_400_000 || dueAt.getTime() > Date.now() + 366 * 86_400_000) {
    throw new ApiError(400, "invalid_due_date");
  }
  return dueAt;
}

export function addReminder(current: Actor, correlation: string, key: string, draft: z.infer<typeof reminderDraft>) {
  return mutate(current.userId, "reminder.create", key, draft, async (tx) => {
    const record = await tx.reminder.create({
      data: { ...draft, dueAt: date(draft.dueAt), playerId: current.userId },
    });
    await audit(tx, current.userId, correlation, "reminder.created", record.id, undefined, {
      category: record.kind, dueAt: record.dueAt.toISOString(), version: record.version,
    });
    return { status: 201, body: reminderView(record) };
  });
}

function state(value: Reminder) {
  return {
    kind: value.kind,
    dueAt: value.dueAt.toISOString(),
    version: value.version,
    done: !!value.doneAt,
    removed: !!value.deletedAt,
  };
}

export function changeReminder(
  current: Actor, correlation: string, key: string, reminderId: string, update: z.infer<typeof reminderUpdate>,
) {
  return mutate(current.userId, "reminder.change:" + reminderId, key, update, async (tx) => {
    const where = { id: reminderId, playerId: current.userId, deletedAt: null };
    const before = await tx.reminder.findFirst({ where });
    if (!before) throw new ApiError(404, "not_found");
    if (before.version !== update.version) throw new ApiError(409, "stale_version");
    const now = new Date();
    const changed = await tx.reminder.updateMany({
      where: { ...where, version: update.version },
      data: {
        version: { increment: 1 },
        ...(update.action === "edit" ? { title: update.title, kind: update.kind, dueAt: date(update.dueAt) } : {}),
        ...(update.action === "done" ? { doneAt: now } : {}),
        ...(update.action === "reopen" ? { doneAt: null } : {}),
        ...(update.action === "remove" ? { deletedAt: now } : {}),
      },
    });
    if (changed.count !== 1) throw new ApiError(409, "stale_version");
    const after = await tx.reminder.findUniqueOrThrow({ where: { id: reminderId } });
    await audit(tx, current.userId, correlation, "reminder." + update.action, reminderId,
      state(before), { ...state(after), titleChanged: before.title !== after.title });
    return { status: 200, body: reminderView(after) };
  });
}
