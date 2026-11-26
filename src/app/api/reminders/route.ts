import { reminderDraft } from "@/shared/domain";
import { actor } from "@/server/auth";
import { body, route } from "@/server/http";
import { mutationKey } from "@/server/mutation";
import { addReminder, hasDueReminder, listReminders } from "@/server/reminders";

export function GET(request: Request) {
  return route(request, "/api/reminders", async ({ json }) => {
    const current = await actor(request);
    const query = new URL(request.url).searchParams;
    if (query.get("due") === "1") return json({ due: await hasDueReminder(current.userId) });
    return json(await listReminders(current.userId, query.get("cursor")));
  }, { authenticatedFeature: true });
}

export function POST(request: Request) {
  return route(request, "/api/reminders", async ({ id, json }) => {
    const current = await actor(request);
    const payload = await body(request, reminderDraft);
    const reply = await addReminder(current, id, mutationKey(request), payload);
    return json(reply.body, reply.status);
  }, { authenticatedFeature: true });
}
