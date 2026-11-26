import { type AccountView, levelSchema } from "@/shared/domain";
import { actor, signInOptions } from "@/server/auth";
import { mode } from "@/server/config";
import { database } from "@/server/db";
import { ApiError, route } from "@/server/http";

export function GET(request: Request) {
  return route(request, "/api/account", async ({ json }) => {
    if (mode() === "demo") return json<AccountView>({ state: "disabled", providers: [], localLogin: false });
    try {
      const current = await actor(request, false);
      if (!current.assured) {
        const factor = await database().authenticator.findUnique({ where: { userId: current.userId }, select: { enrolledAt: true } });
        return json<AccountView>({ state: factor?.enrolledAt ? "verify" : "enroll" });
      }
      const levels = await database().playerProgress.findMany({
        where: { playerId: current.userId }, select: { game: true, difficulty: true },
      });
      return json<AccountView>({
        state: "ready", id: current.userId, role: current.role,
        levels: Object.fromEntries(levels.map(({ game, difficulty }) => [game, levelSchema.parse(difficulty)])),
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return json<AccountView>({ state: "signed-out", ...signInOptions() });
      }
      throw error;
    }
  });
}
