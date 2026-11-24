import { setTimeout as delay } from "node:timers/promises";
import { idSchema } from "@/shared/domain";
import { actor } from "@/server/auth";
import { guardedLimit, route } from "@/server/http";
import { readPlan } from "@/server/practice";

export const dynamic = "force-dynamic";

export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return route(request, "/api/practice/:id", async ({ json }) => {
    const current = await actor(request);
    const id = idSchema.parse((await context.params).id);
    const first = await readPlan(current, id);
    if (new URL(request.url).searchParams.get("stream") !== "1") return json(first);
    await guardedLimit("plan-stream:" + current.userId, 8, 60_000);
    const stop = new AbortController();
    const signal = AbortSignal.any([request.signal, stop.signal]);
    const encode = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const until = Date.now() + 18_000;
        try {
          let frame = first;
          for (;;) {
            if (signal.aborted) break;
            controller.enqueue(encode.encode("event: plan\ndata: " + JSON.stringify(frame) + "\n\n"));
            if (frame.state === "DONE" || frame.state === "FAILED" || Date.now() >= until) break;
            await delay(1_300, undefined, { signal });
            frame = await readPlan(current, id);
          }
          if (!signal.aborted) controller.close();
        } catch {
          if (!signal.aborted) controller.close();
        }
      },
      cancel() { stop.abort(); },
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "X-Accel-Buffering": "no" },
    });
  }, { authenticatedFeature: true });
}
