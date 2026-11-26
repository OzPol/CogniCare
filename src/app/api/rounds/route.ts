import { activitySubmission } from "@/shared/domain";
import { actor } from "@/server/auth";
import { ApiError, body, route } from "@/server/http";
import { mutationKey } from "@/server/mutation";
import { recordRound } from "@/server/rounds";

export function POST(request: Request) {
  return route(request, "/api/rounds", async ({ id, json }) => {
    const current = await actor(request);
    if (request.headers.get("x-activity-owner") !== current.userId) throw new ApiError(403, "activity_account_changed");
    const payload = await body(request, activitySubmission);
    const result = await recordRound(current, id, mutationKey(request), payload);
    return json(result.body, result.status);
  }, { authenticatedFeature: true });
}
