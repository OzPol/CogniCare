import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Secret, TOTP } from "otpauth";
import Redis from "ioredis";
import pg from "pg";
import { catalogReader } from "../src/server/catalog";
import { redis } from "../src/server/redis";
import type { Game } from "../src/shared/domain";

const base = process.env.TEST_ORIGIN || "http://localhost:3000";
const second = process.env.TEST_SECOND_ORIGIN;
const playerPassword = process.env.DEV_PLAYER_PASSWORD;
const carePassword = process.env.DEV_CARE_PASSWORD;
assert.ok(playerPassword && carePassword && process.env.DIRECT_DATABASE_URL && process.env.REDIS_URL && process.env.DATABASE_URL);
type Cookie = Map<string, string>;
type Actor = { cookie: Cookie; id: string; recovery: string[]; code: string };

async function call(path: string, options: { cookie?: Cookie; method?: "GET" | "POST" | "PATCH"; value?: object; key?: string; owner?: string; origin?: string } = {}) {
  const { cookie, value, method = "GET", key = randomUUID(), owner, origin = base } = options;
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(cookie ? { Cookie: [...cookie].map(([name, value]) => name + "=" + value).join("; ") } : {}),
      ...(method !== "GET" ? { Origin: origin, "Content-Type": "application/json", "Idempotency-Key": key } : {}),
      ...(owner ? { "X-Activity-Owner": owner } : {}),
    },
    body: method !== "GET" ? JSON.stringify(value ?? {}) : undefined,
  });
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    if (index > 0 && cookie) {
      const name = pair.slice(0, index);
      const token = pair.slice(index + 1);
      if (token) cookie.set(name, token); else cookie.delete(name);
    }
  }
  return { response, data: await response.json() };
}

async function login(email: string, password: string) {
  const cookie: Cookie = new Map();
  const result = await call("/api/auth/sign-in/email", { cookie, method: "POST", value: { email, password } });
  assert.equal(result.response.status, 200, JSON.stringify(result.data));
  assert.ok(cookie.size > 0);
  assert.deepEqual(result.data, { ok: true });
  return cookie;
}

async function enroll(email: string, password: string): Promise<Actor> {
  const cookie = await login(email, password);
  const before = await call("/api/account", { cookie });
  assert.equal(before.data.state, "enroll");
  assert.equal((await call("/api/reminders", { cookie })).response.status, 403);
  const setup = await call("/api/factor/enroll", { cookie, method: "POST" });
  assert.equal(setup.response.status, 200, JSON.stringify(setup.data));
  assert.match(setup.data.qr, /^data:image\/png/);
  const code = new TOTP({ secret: Secret.fromBase32(setup.data.key) }).generate();
  const verified = await call("/api/factor/verify", { cookie, method: "POST", value: { code } });
  assert.equal(verified.response.status, 200, JSON.stringify(verified.data));
  assert.equal(verified.data.recovery.length, 8);
  const state = await call("/api/account", { cookie });
  assert.equal(state.data.state, "ready");
  return { cookie, id: state.data.id, recovery: verified.data.recovery, code };
}

after(() => redis().disconnect());

test("two independent cache readers coalesce 1,000 simultaneous requests into one PostgreSQL read", async () => {
  const first = new Redis(process.env.REDIS_URL!);
  const other = new Redis(process.env.REDIS_URL!);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const lookup = "cogni:test:" + randomUUID();
  let reads = 0;
  const load = async () => {
    reads++;
    const { rows } = await pool.query<{ game: Game }>('SELECT "game" FROM "Exercise" ORDER BY "order"');
    return rows.map(({ game }) => game);
  };
  const readers = [catalogReader(first, load, lookup), catalogReader(other, load, lookup)];
  try {
    const results = await Promise.all(Array.from({ length: 1_000 }, (_, index) => readers[index % 2]()));
    assert.equal(reads, 1);
    assert.equal(results.filter((result) => result.join() === "MATCH,FOCUS,ROUTINE,PATTERN").length, 1_000);
    if (second) {
      const responses = await Promise.all([fetch(base + "/api/catalog"), fetch(second + "/api/catalog")]);
      assert.ok(responses.every((response) => response.ok && response.headers.get("cache-control")?.startsWith("public")));
    }
  } finally {
    first.disconnect();
    other.disconnect();
    await pool.end();
  }
});

test("sessions enforce MFA, care consent, atomic writes, and audit grants", { timeout: 50_000 }, async () => {
  const ready = await call("/api/ready");
  assert.equal(ready.response.status, 200, JSON.stringify(ready.data));
  const untrusted = await call("/api/auth/sign-in/email", { method: "POST", origin: "https://invalid.example", value: {} });
  assert.equal(untrusted.response.status, 403);
  assert.equal((await call("/api/reminders")).response.status, 401);

  const player = await enroll("player@example.test", playerPassword);
  const caregiver = await enroll("care@example.test", carePassword);
  const newLogin = await login("player@example.test", playerPassword);
  assert.equal((await call("/api/account", { cookie: newLogin })).data.state, "verify");
  const recovery = player.recovery[0];
  const unlock = await call("/api/factor/verify", { cookie: newLogin, method: "POST", value: { code: recovery } });
  assert.equal(unlock.response.status, 200);
  const another = await login("player@example.test", playerPassword);
  assert.equal((await call("/api/factor/verify", { cookie: another, method: "POST", value: { code: recovery } })).response.status, 400);

  const summaryPath = "/api/care?patient=" + player.id;
  assert.equal((await call(summaryPath, { cookie: caregiver.cookie })).response.status, 404);
  const invite = await call("/api/care/invite", { cookie: player.cookie, method: "POST" });
  assert.equal(invite.response.status, 201, JSON.stringify(invite.data));
  const accept = await call("/api/care/accept", { cookie: caregiver.cookie, method: "POST", value: { code: invite.data.code } });
  assert.equal(accept.response.status, 200, JSON.stringify(accept.data));
  const acceptTwice = await call("/api/care/accept", { cookie: caregiver.cookie, method: "POST", value: { code: invite.data.code } });
  assert.equal(acceptTwice.response.status, 404);

  const key = randomUUID();
  const entry = { title: "Water", kind: "WATER", dueAt: new Date(Date.now() - 60_000).toISOString() };
  const create = () => call("/api/reminders", { cookie: player.cookie, method: "POST", key, value: entry });
  const results = await Promise.all(Array.from({ length: 8 }, create));
  assert.ok(results.every(({ response }) => response.status === 201), JSON.stringify(results.map(({ response, data }) => [response.status, data])));
  assert.equal(new Set(results.map(({ data }) => data.id)).size, 1);
  const wrongBody = await call("/api/reminders", { cookie: player.cookie, method: "POST", key, value: { ...entry, title: "A different title" } });
  assert.equal(wrongBody.response.status, 409);
  assert.equal(wrongBody.data.error, "idempotency_key_reused");

  const ownerPath = "/api/reminders/" + results[0].data.id;
  const unauthorized = await call(ownerPath, { cookie: caregiver.cookie, method: "PATCH", value: { action: "done", version: 1 } });
  assert.equal(unauthorized.response.status, 404);
  const races = await Promise.all([
    call(ownerPath, { cookie: player.cookie, method: "PATCH", value: { action: "edit", version: 1, ...entry, title: "Water in the afternoon" } }),
    call(ownerPath, { cookie: player.cookie, method: "PATCH", value: { action: "edit", version: 1, ...entry, title: "Water at lunch" } }),
  ]);
  assert.deepEqual(races.map(({ response }) => response.status).sort(), [200, 409]);

  const played = { game: "MATCH", difficulty: 1, correct: 3, attempts: 4, playedAt: new Date().toISOString() };
  assert.equal((await call("/api/rounds", { cookie: caregiver.cookie, method: "POST", owner: player.id, value: played })).response.status, 403);
  const activityKey = randomUUID();
  const round = (key: string) => call("/api/rounds", { cookie: player.cookie, method: "POST", owner: player.id, value: played, key });
  const recorded = await Promise.all([round(activityKey), round(activityKey), round(randomUUID())]);
  assert.ok(recorded.every(({ response }) => response.status === 201), JSON.stringify(recorded.map(({ response, data }) => [response.status, data])));
  assert.equal(new Set(recorded.map(({ data }) => data.id)).size, 2);
  const summary = await call(summaryPath, { cookie: caregiver.cookie });
  assert.equal(summary.response.status, 200);
  assert.match(summary.response.headers.get("cache-control") ?? "", /no-store/);
  assert.equal(summary.data.rounds, 2);
  assert.equal(summary.data.overdueCount, 1);
  assert.deepEqual(summary.data.activities, [{ game: "MATCH", rounds: 2, correct: 6, attempts: 8 }]);

  const removed = await call("/api/care/revoke", { cookie: player.cookie, method: "POST", value: { caregiver: caregiver.id } });
  assert.equal(removed.response.status, 200);
  assert.equal((await call(summaryPath, { cookie: caregiver.cookie })).response.status, 404);
  assert.equal((await call("/api/auth/sign-out", { cookie: player.cookie, method: "POST" })).response.status, 200);
  assert.equal((await call("/api/reminders", { cookie: player.cookie })).response.status, 401);

  if (process.env.PRACTICE_PLANS === "true") {
    const job = await call("/api/practice", { cookie: caregiver.cookie, method: "POST", value: { template: "quiet" } });
    assert.equal(job.response.status, 202, JSON.stringify(job.data));
    const request = await fetch(base + "/api/practice/" + job.data.id + "?stream=1", {
      headers: { Cookie: [...caregiver.cookie].map(([name, value]) => name + "=" + value).join("; ") },
      signal: AbortSignal.timeout(25_000),
    });
    assert.equal(request.status, 200);
    const stream = await request.text();
    assert.match(stream, /event: plan/);
    assert.match(stream, /"state":"DONE"/);
    assert.match(stream, /"games":\["MATCH","PATTERN"\]/);
  }

  const runtime = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const owner = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await Promise.all([runtime.connect(), owner.connect()]);
  try {
    const audit = await runtime.query('SELECT "action" FROM "AuditEvent" WHERE "entityId" = $1 ORDER BY "id"', [results[0].data.id]);
    assert.deepEqual(audit.rows.map(({ action }) => action), ["reminder.created", "reminder.edit"]);
    await assert.rejects(runtime.query('DELETE FROM "AuditEvent"'), { code: "42501" });
    await assert.rejects(owner.query('TRUNCATE "AuditEvent"'), /append-only/);
  } finally {
    await Promise.all([runtime.end(), owner.end()]);
  }
});
