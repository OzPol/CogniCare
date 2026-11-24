import { route } from "@/server/http";

export function GET(request: Request) {
  return route(request, "/api/health", ({ json }) => json({ status: "alive" }), { health: true });
}
