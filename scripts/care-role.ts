import "dotenv/config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database } from "@/server/db";
import { audit } from "@/server/mutation";

const email = z.email().parse(process.argv[2]).toLowerCase();
const role = z.enum(["PLAYER", "CAREGIVER", "HEALTH_WORKER"]).parse(process.argv[3]);
const adminIdentity = z.string().min(1).max(80).parse(process.env.ROLE_ADMIN_ID);
if (!process.env.DIRECT_DATABASE_URL) throw new Error("Supply an authorized direct PostgreSQL connection.");
process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;

try {
  await database().$transaction(async (tx) => {
    const current = await tx.user.findUniqueOrThrow({ where: { email } });
    if (current.role === role) return;
    await tx.user.update({ where: { id: current.id }, data: { role } });
    await tx.session.deleteMany({ where: { userId: current.id } });
    if (role === "PLAYER") {
      await tx.careLink.updateMany({ where: { caregiverId: current.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await audit(tx, "admin:" + adminIdentity, randomUUID(), "account.role_changed", current.id,
      { role: current.role }, { role });
  });
  console.log("Role is now " + role + ". A new sign-in is required.");
} finally {
  await database().$disconnect();
}
