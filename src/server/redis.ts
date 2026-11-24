import Redis from "ioredis";

const state = globalThis as typeof globalThis & { cogniRedis?: Redis };

export function redis() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is required.");
  state.cogniRedis ??= new Redis(url, {
    lazyConnect: true,
    connectTimeout: 1_500,
    commandTimeout: 1_750,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: true,
    retryStrategy: (attempt) => Math.min(250 * attempt, 2_000),
  });
  return state.cogniRedis;
}

const incrementWithExpiry = /* lua */ `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
`;

export async function limit(key: string, maximum: number, milliseconds: number) {
  const [count, remaining] = await redis().eval(incrementWithExpiry, 1, "cogni:limit:" + key, milliseconds) as [number, number];
  return count <= maximum ? 0 : Math.max(1, Math.ceil(remaining / 1_000));
}
