import "dotenv/config";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Role } from "@/shared/domain";
import { mode, origin } from "@/server/config";
import { database } from "@/server/db";

const direct = process.env.DIRECT_DATABASE_URL;
if (mode() !== "local" || !direct || !["127.0.0.1", "localhost"].includes(new URL(direct).hostname)) {
  throw new Error("Sample accounts can only be installed in a local PostgreSQL database.");
}
origin();
process.env.DATABASE_URL = direct;
const users = [
  { email: "player@example.test", name: "Taylor Lane", role: "PLAYER", password: process.env.DEV_PLAYER_PASSWORD },
  { email: "care@example.test", name: "Robin Lane", role: "CAREGIVER", password: process.env.DEV_CARE_PASSWORD },
] as const satisfies ReadonlyArray<{ email: string; name: string; role: Role; password: string | undefined }>;

try {
  for (const { email, name, role, password } of users) {
    if (!password || password.length < 12) throw new Error("Set both local sample passwords in .env.");
    const digest = await hashPassword(password);
    await database().$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email }, update: {},
        create: { email, name, role, emailVerified: true },
      });
      const account = { providerId: "credential", accountId: user.id };
      await tx.account.upsert({
        where: { providerId_accountId: account }, update: { password: digest },
        create: { ...account, id: randomUUID(), userId: user.id, password: digest },
      });
    });
    console.log("Sample account " + email + " uses " + (role === "PLAYER" ? "DEV_PLAYER_PASSWORD" : "DEV_CARE_PASSWORD") + " in .env.");
  }
} finally {
  await database().$disconnect();
}
