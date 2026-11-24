export class RequestError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

export async function api<T>(
  path: string,
  change?: { method?: "POST" | "PATCH"; data?: unknown; key?: string; owner?: string },
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
    ...(change ? {
      method: change.method ?? "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": change.key ?? crypto.randomUUID(),
        ...(change.owner ? { "X-Activity-Owner": change.owner } : {}) },
      body: JSON.stringify(change.data ?? {}),
    } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(response.status,
    typeof data.error === "string" ? data.error : typeof data.code === "string" ? data.code : "server_error");
  return data as T;
}
