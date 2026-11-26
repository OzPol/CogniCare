import { z } from "zod";
import { patientId, invitationCode } from "@/shared/domain";
import { actor } from "@/server/auth";
import { acceptInvite, invite, revoke } from "@/server/care";
import { ApiError, body, route } from "@/server/http";
import { mutationKey } from "@/server/mutation";

export function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  return route(request, "/api/care/:action", async ({ id, json }) => {
    const current = await actor(request);
    const key = mutationKey(request);
    const { action } = await context.params;
    if (action === "invite") {
      await body(request, z.strictObject({}));
      const result = await invite(current, id, key);
      return json(result.body, result.status);
    }
    if (action === "accept") {
      const { code } = await body(request, z.strictObject({ code: invitationCode }));
      const result = await acceptInvite(current, id, key, code);
      return json(result.body, result.status);
    }
    if (action === "revoke") {
      const { caregiver } = await body(request, z.strictObject({ caregiver: patientId }));
      const result = await revoke(current, id, key, caregiver);
      return json(result.body, result.status);
    }
    throw new ApiError(404, "not_found");
  }, { authenticatedFeature: true });
}
