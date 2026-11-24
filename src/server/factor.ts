import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import QRCode from "qrcode";
import { z } from "zod";
import type { Actor } from "./auth";
import { secret } from "./config";
import { database } from "./db";
import { ApiError, guardedLimit } from "./http";
import { audit, mutate } from "./mutation";

const period = 30;
const setupTimeMs = 15 * 60_000;
const recoveryCount = 8;
export const codeSchema = z.strictObject({
  code: z.string().trim().toLowerCase().regex(/^(\d{6}|[a-f0-9]{4}(-[a-f0-9]{4}){4})$/),
});
const key = () => Buffer.from(secret("MFA_KEY"), "hex");

function encrypt(value: string, userId: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(userId));
  const contents = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), contents]).toString("base64url");
}

function decrypt(value: string, userId: string) {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
}

function totp(value: string, label = "CogniCare account") {
  return new TOTP({ issuer: "CogniCare", label, secret: Secret.fromBase32(value), algorithm: "SHA1", digits: 6, period });
}

function recoveryCodes(value: string, userId: string) {
  return Array.from({ length: recoveryCount }, (_, index) => {
    const data = "recovery-v1:" + userId + ":" + value + ":" + index;
    const hex = createHmac("sha256", key()).update(data).digest("hex").slice(0, 20);
    return hex.replace(/(.{4})(?=.)/g, "$1-");
  });
}

function digest(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export async function enroll(actor: Actor, id: string, mutationId: string) {
  const now = new Date();
  await mutate(actor.userId, "factor.enroll:" + actor.sessionId, mutationId, {}, async (tx) => {
    const encrypted = encrypt(new Secret({ size: 20 }).base32, actor.userId);
    const changed = await tx.$executeRaw`
      INSERT INTO "Authenticator" ("userId", "secret", "boundSession", "pendingUntil")
      VALUES (${actor.userId}, ${encrypted}, ${actor.sessionId}, ${new Date(now.getTime() + setupTimeMs)})
      ON CONFLICT ("userId") DO UPDATE SET
        "secret" = EXCLUDED."secret", "boundSession" = EXCLUDED."boundSession", "pendingUntil" = EXCLUDED."pendingUntil"
      WHERE "Authenticator"."enrolledAt" IS NULL AND "Authenticator"."pendingUntil" <= ${now}
    `;
    const current = await tx.authenticator.findUniqueOrThrow({ where: { userId: actor.userId } });
    if (current.enrolledAt) throw new ApiError(409, "already_enrolled");
    if (current.boundSession !== actor.sessionId) throw new ApiError(409, "setup_in_progress");
    if (changed) await audit(tx, actor.userId, id, "factor.enrollment_started", actor.userId, undefined, { pending: true });
    return { status: 200, body: { pending: true } };
  });
  const row = await database().authenticator.findUnique({ where: { userId: actor.userId } });
  if (!row || row.enrolledAt || row.boundSession !== actor.sessionId || row.pendingUntil <= now) {
    throw new ApiError(409, "setup_expired");
  }
  const value = decrypt(row.secret, actor.userId);
  const user = await database().user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });
  const qr = await QRCode.toDataURL(totp(value, user.email).toString(), { width: 240, margin: 3, errorCorrectionLevel: "M" });
  return { key: value, qr };
}

export async function verify(actor: Actor, id: string, mutationId: string, code: string) {
  await guardedLimit("factor:" + actor.userId, 10, 10 * 60_000);
  const receipt = await mutate(
    actor.userId, "factor.verify:" + actor.sessionId, mutationId,
    { code: createHmac("sha256", key()).update(code).digest("hex") },
    async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM "Authenticator" WHERE "userId" = ${actor.userId} FOR UPDATE`;
      const row = await tx.authenticator.findUnique({ where: { userId: actor.userId } });
      const now = new Date();
      const enrolling = !row?.enrolledAt;
      if (!row || (enrolling && (row.boundSession !== actor.sessionId || row.pendingUntil <= now))) {
        throw new ApiError(409, "setup_expired");
      }
      const value = decrypt(row.secret, actor.userId);
      if (code.includes("-")) {
        if (enrolling) throw new ApiError(400, "invalid_code");
        const used = await tx.recoveryCode.updateMany({
          where: { userId: actor.userId, digest: digest(code), usedAt: null }, data: { usedAt: now },
        });
        if (used.count !== 1) throw new ApiError(400, "invalid_code");
      } else {
        const delta = totp(value).validate({ token: code, timestamp: now.getTime(), window: 1 });
        const step = BigInt(Math.floor(now.getTime() / (period * 1_000)) + (delta ?? 0));
        if (delta === null || step <= row.lastStep) throw new ApiError(400, "invalid_code");
        await tx.authenticator.update({
          where: { userId: actor.userId },
          data: { lastStep: step, ...(enrolling ? { enrolledAt: now, boundSession: null } : {}) },
        });
        if (enrolling) {
          await tx.recoveryCode.createMany({
            data: recoveryCodes(value, actor.userId).map((backup) => ({ userId: actor.userId, digest: digest(backup) })),
          });
        }
      }
      const session = await tx.session.updateMany({
        where: { id: actor.sessionId, userId: actor.userId, expiresAt: { gt: now } }, data: { assuredAt: now },
      });
      if (session.count !== 1) throw new ApiError(401, "sign_in");
      await audit(tx, actor.userId, id, enrolling ? "factor.enrolled" : "factor.verified", actor.sessionId,
        { assured: actor.assured }, { assured: true, recoveryUsed: code.includes("-") });
      return { status: 200, body: { enrolled: enrolling } };
    },
  );
  if (!receipt.body.enrolled) return { recovery: [] };
  const row = await database().authenticator.findUniqueOrThrow({ where: { userId: actor.userId } });
  return { recovery: recoveryCodes(decrypt(row.secret, actor.userId), actor.userId) };
}
