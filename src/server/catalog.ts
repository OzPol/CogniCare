import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type Redis from "ioredis";
import { z } from "zod";
import { type Game, gameSchema } from "@/shared/domain";
import { database } from "./db";
import { ApiError } from "./http";
import { redis } from "./redis";

const catalogSchema = z.array(gameSchema);
const finish = /* lua */ `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  if ARGV[2] ~= '' then redis.call('SET', KEYS[2], ARGV[2], 'EX', 180) end
  redis.call('DEL', KEYS[1])
  return 1
`;

export function catalogReader(client: Redis, load: () => Promise<Game[]>, cacheKey = "cogni:catalog:v1") {
  const lock = cacheKey + ":lease";
  let pending: Promise<Game[]> | undefined;

  async function distributedRead() {
    const token = randomUUID();
    const deadline = Date.now() + 2_500;
    do {
      const cached = await client.get(cacheKey);
      if (cached) return catalogSchema.parse(JSON.parse(cached));
      if (await client.set(lock, token, "PX", 12_000, "NX")) {
        let value = "";
        try {
          const filled = await client.get(cacheKey);
          const result = filled ? catalogSchema.parse(JSON.parse(filled)) : await load();
          value = JSON.stringify(result);
          return result;
        } finally {
          await client.eval(finish, 2, lock, cacheKey, token, value);
        }
      }
      await delay(30 + Math.floor(Math.random() * 40));
    } while (Date.now() < deadline);
    throw new ApiError(503, "temporarily_unavailable", 2);
  }

  return () => {
    pending ??= distributedRead().finally(() => { pending = undefined; });
    return pending;
  };
}

let read: ReturnType<typeof catalogReader> | undefined;
export function catalog() {
  read ??= catalogReader(redis(), async () => {
    const rows = await database().exercise.findMany({
      where: { enabled: true }, select: { game: true }, orderBy: { order: "asc" },
    });
    return rows.map(({ game }) => game);
  });
  return read();
}
