import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { ZodError, type ZodType } from "zod";
import { mode, origin } from "./config";
import { limit } from "./redis";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly retryAfter?: number) {
    super(code);
  }
}

export type Boundary = {
  id: string;
  json: <T>(data: T, status?: number) => Response;
};

export async function guardedLimit(key: string, maximum: number, milliseconds: number) {
  let wait: number;
  try {
    wait = await limit(key, maximum, milliseconds);
  } catch {
    throw new ApiError(503, "temporarily_unavailable", 2);
  }
  if (wait) throw new ApiError(429, "slow_down", wait);
}

function browserOrigin(request: Request) {
  // Browser requests to mutation APIs must originate from our own configured host.
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("origin") !== origin()) throw new ApiError(403, "invalid_origin");
  }
}

export async function route(
  request: Request,
  path: string,
  handler: (boundary: Boundary) => Promise<Response> | Response,
  options: { health?: boolean; authenticatedFeature?: boolean; publicCache?: boolean; strict?: boolean } = {},
) {
  const id = randomUUID();
  const started = performance.now();
  const json = <T,>(data: T, status = 200) => Response.json(data, { status });
  let response: Response;
  try {
    if (!options.health) {
      const currentMode = mode();
      if (currentMode === "demo" && options.authenticatedFeature) throw new ApiError(503, "accounts_disabled");
      browserOrigin(request);
      if (currentMode !== "demo") {
        const ip = currentMode === "service" ? request.headers.get("x-cognicare-client-ip") : "127.0.0.1";
        if (!ip || !isIP(ip)) throw new ApiError(403, "gateway_required");
        const fingerprint = createHash("sha256").update(ip).digest("hex").slice(0, 24);
        await guardedLimit("ip:" + fingerprint, 3_000, 60_000);
        if (options.strict) await guardedLimit("auth-ip:" + fingerprint, 40, 60_000);
      }
    }
    response = await handler({ id, json });
  } catch (error) {
    const handled = error instanceof ApiError
      ? error
      : error instanceof ZodError
        ? new ApiError(400, "invalid_input")
        : new ApiError(500, "server_error");
    if (handled.status === 500) {
      console.error(JSON.stringify({
        event: "request_error", id, path,
        type: error instanceof Error ? error.name : "Unknown",
        code: error && typeof error === "object" && "code" in error ? error.code : undefined,
      }));
    }
    const headers: HeadersInit = handled.retryAfter ? { "Retry-After": String(handled.retryAfter) } : {};
    response = Response.json({ error: handled.code, correlationId: id }, { status: handled.status, headers });
  }
  const headers = new Headers(response.headers);
  if (!options.publicCache || !response.ok || !headers.has("Cache-Control")) {
    headers.set("Cache-Control", "private, no-store");
  }
  headers.set("X-Request-ID", id);
  console.info(JSON.stringify({
    event: "request", id, path, method: request.method, status: response.status,
    durationMs: Math.round(performance.now() - started),
  }));
  return new Response(response.body, { status: response.status, headers });
}

export async function body<T>(request: Request, schema: ZodType<T>): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    throw new ApiError(415, "json_required");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "invalid_input");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let value = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16_384) {
        await reader.cancel();
        throw new ApiError(413, "payload_too_large");
      }
      value += decoder.decode(chunk.value, { stream: true });
    }
    value += decoder.decode();
    return schema.parse(JSON.parse(value));
  } catch (error) {
    if (error instanceof ApiError || error instanceof ZodError) throw error;
    throw new ApiError(400, "invalid_input");
  } finally {
    reader.releaseLock();
  }
}
