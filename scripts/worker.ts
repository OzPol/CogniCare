import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { planningConnector } from "@/server/ai";
import { practiceEnabled, mode } from "@/server/config";
import { database } from "@/server/db";
import { processPlan } from "@/server/practice";

if (mode() === "demo" || !practiceEnabled()) throw new Error("Enable practice planning in a database-backed mode.");
const connector = planningConnector();
let stopped = false;
process.on("SIGINT", () => { stopped = true; });
process.on("SIGTERM", () => { stopped = true; });
console.info(JSON.stringify({ event: "practice_worker_started" }));

while (!stopped) {
  try {
    const worked = await processPlan(connector);
    if (!worked) await delay(1_000);
  } catch {
    console.error(JSON.stringify({ event: "practice_worker_failed", nextPollMs: 2_000 }));
    await delay(2_000);
  }
}
await database().$disconnect();
process.exit(0);
