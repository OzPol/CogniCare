import { practiceInput } from "@/shared/domain";
import { actor } from "@/server/auth";
import { practiceEnabled } from "@/server/config";
import { ApiError, body, route } from "@/server/http";
import { mutationKey } from "@/server/mutation";
import { queuePlan } from "@/server/practice";

export function GET(request: Request) {
  return route(request, "/api/practice", async ({ json }) => {
    const current = await actor(request);
    if (current.role === "PLAYER") throw new ApiError(403, "access_denied");
    return json({ enabled: practiceEnabled() });
  }, { authenticatedFeature: true });
}

export function POST(request: Request) {
  return route(request, "/api/practice", async ({ json, id }) => {
    const current = await actor(request);
    const result = await queuePlan(current, id, mutationKey(request), await body(request, practiceInput));
    return json(result.body, result.status);
  }, { authenticatedFeature: true });
}
