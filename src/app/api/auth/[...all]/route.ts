import { auth, signInOptions } from "@/server/auth";
import { route, ApiError, body, guardedLimit } from "@/server/http";
import { createHash } from "node:crypto";
import { z } from "zod";

const base = "/api/auth/";
const login = z.strictObject({ email: z.email().max(254), password: z.string().min(1).max(128) });
const social = z.strictObject({ provider: z.enum(["google", "microsoft", "github"]) });

async function cookieReply(response: Response) {
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  await response.body?.cancel();
  return Response.json({ ok: true }, { headers });
}

export function GET(request: Request) {
  return route(request, "/api/auth/callback", () => {
    const pattern = new URL(request.url).pathname.slice(base.length);
    const allowed = signInOptions().providers.some((provider) => pattern === "callback/" + provider);
    if (!allowed) throw new ApiError(404, "not_found");
    return auth().handler(request);
  }, { authenticatedFeature: true, strict: true });
}

export function POST(request: Request) {
  return route(request, "/api/auth", async () => {
    const path = new URL(request.url).pathname;
    if (path === base + "sign-out") return cookieReply(await auth().handler(request));
    if (path === base + "sign-in/email" && signInOptions().localLogin) {
      const data = await body(request.clone(), login);
      const key = createHash("sha256").update(data.email.toLowerCase()).digest("hex");
      await guardedLimit("credentials:" + key, 8, 15 * 60_000);
      return cookieReply(await auth().handler(request));
    }
    if (path === base + "sign-in/social") {
      const data = await body(request.clone(), social);
      if (!signInOptions().providers.includes(data.provider)) throw new ApiError(404, "not_found");
      const next = new Request(request.url, {
        method: "POST", headers: request.headers, body: JSON.stringify({ ...data, callbackURL: "/?account=1", disableRedirect: true }),
      });
      next.headers.delete("content-length");
      return auth().handler(next);
    }
    throw new ApiError(404, "not_found");
  }, { authenticatedFeature: true, strict: true });
}
