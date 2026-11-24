import { z } from "zod";
import { planOutput, type PlanOutput, type PracticeInput } from "@/shared/domain";
import { limit, redis } from "./redis";

export interface AIConnector {
  suggest(input: PracticeInput): Promise<PlanOutput>;
}

export const builtInPlans: Record<PracticeInput["template"], PlanOutput> = {
  quiet: { games: ["MATCH", "PATTERN"] },
  variety: { games: ["FOCUS", "MATCH"] },
  routine: { games: ["ROUTINE", "PATTERN"] },
};

type Provider = { id: "PRIMARY" | "FALLBACK"; endpoint: URL; model: string; key?: string };

function provider(id: Provider["id"]): Provider | undefined {
  const raw = process.env["AI_" + id + "_URL"];
  const model = process.env["AI_" + id + "_MODEL"];
  if (!raw || !model) return;
  const endpoint = new URL(raw.replace(/\/+$/, "") + "/chat/completions");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
    (endpoint.protocol !== "https:" && !(loopback && endpoint.protocol === "http:"))) {
    throw new Error("AI endpoint must use HTTPS or loopback HTTP.");
  }
  const key = process.env["AI_" + id + "_KEY"];
  return { id, endpoint, model, key };
}

const providerResponse = z.object({ choices: z.array(z.object({
  message: z.object({ content: z.string().max(256) }),
})).min(1) });

async function readResponse(response: Response) {
  let content = "";
  let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty provider response");
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 16_384) {
        await reader.cancel();
        throw new Error("Provider response too large");
      }
      content += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(content + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

async function call(target: Provider, input: PracticeInput) {
  const response = await fetch(target.endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
    headers: {
      "Content-Type": "application/json",
      ...(target.key ? { Authorization: "Bearer " + target.key } : {}),
    },
    body: JSON.stringify({
      model: target.model,
      max_tokens: 64,
      temperature: 0,
      messages: [
        { role: "system", content: 'Assemble a general activity playlist. Output only JSON {"games":["MATCH","FOCUS"]} with two distinct values from MATCH, FOCUS, ROUTINE, PATTERN. Do not return prose.' },
        { role: "user", content: "Playlist style: " + input.template },
      ],
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Provider unavailable");
  }
  const parsed = providerResponse.parse(await readResponse(response));
  return planOutput.parse(JSON.parse(parsed.choices[0].message.content));
}

export function planningConnector(): AIConnector {
  const providers = [provider("PRIMARY"), provider("FALLBACK")].filter((target) => target !== undefined);
  const budget = z.coerce.number().int().min(0).max(2_000).parse(process.env.AI_DAILY_CALLS ?? "100");
  return {
    async suggest(input) {
      for (const target of providers) {
        if (!budget) break;
        const breaker = "cogni:ai:breaker:" + target.id;
        try {
          if (await redis().exists(breaker)) continue;
          if (await limit("ai:aggregate", budget, 86_400_000)) break;
        } catch {
          break; // Preserve the provider budget if Valkey is unavailable.
        }
        try {
          const result = await call(target, input);
          await redis().del("cogni:limit:ai:failures:" + target.id).catch(() => undefined);
          return result;
        } catch {
          try {
            if (await limit("ai:failures:" + target.id, 2, 60_000)) {
              await redis().set(breaker, "1", "EX", 90);
            }
          } catch {
            break;
          }
        }
      }
      return builtInPlans[input.template];
    },
  };
}
