import { z } from "zod";
import { actor } from "@/server/auth";
import { codeSchema, enroll, verify } from "@/server/factor";
import { ApiError, body, route } from "@/server/http";
import { mutationKey } from "@/server/mutation";

export function POST(request: Request, context: { params: Promise<{ step: string }> }) {
  return route(request, "/api/factor/:step", async ({ id, json }) => {
    const current = await actor(request, false);
    const { step } = await context.params;
    const key = mutationKey(request);
    if (step === "enroll") {
      await body(request, z.strictObject({}));
      return json(await enroll(current, id, key));
    }
    if (step === "verify") {
      const { code } = await body(request, codeSchema);
      return json(await verify(current, id, key, code));
    }
    throw new ApiError(404, "not_found");
  }, { authenticatedFeature: true, strict: true });
}
