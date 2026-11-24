import { patientId } from "@/shared/domain";
import { actor } from "@/server/auth";
import { careList, careSummary } from "@/server/care";
import { route } from "@/server/http";

export function GET(request: Request) {
  return route(request, "/api/care", async ({ json }) => {
    const current = await actor(request);
    const target = new URL(request.url).searchParams.get("patient");
    return json(target ? await careSummary(current, patientId.parse(target)) : await careList(current));
  }, { authenticatedFeature: true });
}
