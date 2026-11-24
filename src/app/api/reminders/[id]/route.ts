import { idSchema, reminderUpdate } from "@/shared/domain";
import { actor } from "@/server/auth";
import { body, route } from "@/server/http";
import { mutationKey } from "@/server/mutation";
import { changeReminder } from "@/server/reminders";

export function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(request, "/api/reminders/:id", async ({ id, json }) => {
    const current = await actor(request);
    const target = idSchema.parse((await context.params).id);
    const data = await body(request, reminderUpdate);
    const reply = await changeReminder(current, id, mutationKey(request), target, data);
    return json(reply.body, reply.status);
  }, { authenticatedFeature: true });
}
