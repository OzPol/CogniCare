import { games } from "@/shared/domain";
import { catalog } from "@/server/catalog";
import { mode } from "@/server/config";
import { ApiError, route } from "@/server/http";

export function GET(request: Request) {
  return route(request, "/api/catalog", async () => {
    try {
      return Response.json(
        { games: mode() === "demo" ? games : await catalog() },
        { headers: { "Cache-Control": "public, max-age=45, s-maxage=90, stale-while-revalidate=180" } },
      );
    } catch {
      throw new ApiError(503, "temporarily_unavailable", 2);
    }
  }, { publicCache: true });
}
