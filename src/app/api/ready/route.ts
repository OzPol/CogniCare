import { mode, origin, secret } from "@/server/config";
import { database } from "@/server/db";
import { redis } from "@/server/redis";
import { route } from "@/server/http";

export function GET(request: Request) {
  return route(request, "/api/ready", async ({ json }) => {
    if (mode() === "demo") return json({ status: "ready", mode: "demo" });
    try {
      origin();
      secret("AUTH_SECRET");
      secret("MFA_KEY");
      const [, ping] = await Promise.all([
        database().exercise.count(),
        redis().ping(),
      ]);
      if (ping !== "PONG") throw new Error("Cache check failed");
      return json({ status: "ready" });
    } catch {
      return json({ status: "unavailable" }, 503);
    }
  }, { health: true });
}
