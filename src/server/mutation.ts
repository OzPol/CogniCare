import { createHash } from "node:crypto";
import { idSchema } from "@/shared/domain";
import type { Prisma } from "@/generated/prisma/client";
import { database, type Tx } from "./db";
import { ApiError } from "./http";

type Receipt<T> = { status: number; body: T };
type Json = Prisma.InputJsonValue;

export function mutationKey(request: Request) {
  const parsed = idSchema.safeParse(request.headers.get("idempotency-key"));
  if (!parsed.success) throw new ApiError(400, "idempotency_key_required");
  return parsed.data.toLowerCase();
}

export async function mutate<T extends Json>(
  actorId: string, operation: string, key: string, input: unknown, execute: (tx: Tx) => Promise<Receipt<T>>,
): Promise<Receipt<T>> {
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const identity = { actorId, operation, key };
  return database().$transaction(async (tx) => {
    const claimed = await tx.$executeRaw`
      INSERT INTO "IdempotencyReceipt" ("actorId", "operation", "key", "fingerprint")
      VALUES (${actorId}, ${operation}, ${key}::uuid, ${fingerprint})
      ON CONFLICT ("actorId", "operation", "key") DO NOTHING
    `;
    if (!claimed) {
      const prior = await tx.idempotencyReceipt.findUniqueOrThrow({ where: { actorId_operation_key: identity } });
      if (prior.fingerprint !== fingerprint) throw new ApiError(409, "idempotency_key_reused");
      if (!prior.status || prior.response === null) throw new ApiError(503, "try_again", 2);
      return { status: prior.status, body: prior.response as T };
    }
    const result = await execute(tx);
    await tx.idempotencyReceipt.update({
      where: { actorId_operation_key: identity },
      data: { status: result.status, response: result.body },
    });
    return result;
  }, { maxWait: 5_000, timeout: 10_000 });
}

export async function audit(
  tx: Tx, actorId: string, correlationId: string, action: string, entityId: string,
  before?: Prisma.InputJsonValue, after?: Prisma.InputJsonValue,
) {
  await tx.auditEvent.create({ data: { actorId, correlationId, action, entityId, before, after } });
}
