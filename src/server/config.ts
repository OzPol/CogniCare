import { z } from "zod";

const modeSchema = z.enum(["demo", "local", "service"]);
export function mode() {
  return modeSchema.parse(process.env.COGNICARE_MODE ?? "demo");
}

export function origin() {
  const value = new URL(process.env.APP_ORIGIN ?? "http://localhost:3000");
  if (value.href !== value.origin + "/") throw new Error("APP_ORIGIN must be an origin.");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(value.hostname);
  if (mode() === "local" && !loopback) throw new Error("Local mode requires a loopback origin.");
  if (mode() === "service" && value.protocol !== "https:") throw new Error("Service mode requires HTTPS.");
  return value.origin;
}

export function secret(name: "AUTH_SECRET" | "MFA_KEY") {
  const value = process.env[name];
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error(name + " must contain 32 random bytes in hex.");
  return value;
}

export function practiceEnabled() {
  return process.env.PRACTICE_PLANS === "true";
}
