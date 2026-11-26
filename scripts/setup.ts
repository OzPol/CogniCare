import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse } from "dotenv";

function run(program: string, args: string[]) {
  const called = spawnSync(program, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (called.error || called.status !== 0) throw new Error(program + " " + args.join(" ") + " failed.");
}

run("docker", ["compose", "version"]);
if (!existsSync(".env")) {
  const template = readFileSync(".env.example", "utf8");
  const contents = template
    .replace(/^AUTH_SECRET=$/m, "AUTH_SECRET=" + randomBytes(32).toString("hex"))
    .replace(/^MFA_KEY=$/m, "MFA_KEY=" + randomBytes(32).toString("hex"))
    + "\nDEV_PLAYER_PASSWORD=" + randomBytes(18).toString("base64url")
    + "\nDEV_CARE_PASSWORD=" + randomBytes(18).toString("base64url") + "\n";
  writeFileSync(".env", contents, { flag: "wx", mode: 0o600 });
}

const local = parse(readFileSync(".env"));
if (local.COGNICARE_MODE !== "local" || local.APP_ORIGIN !== "http://localhost:3000" ||
  local.DIRECT_DATABASE_URL !== "postgresql://cognicare_owner:cognicare_local_owner@127.0.0.1:5432/cognicare" ||
  local.DATABASE_URL !== "postgresql://cognicare_app:cognicare_local_app@127.0.0.1:6432/cognicare") {
  throw new Error("Automatic setup is for the local Compose settings in .env.example.");
}

run("docker", ["compose", "up", "-d", "--wait"]);
run("npm", ["run", "db:deploy"]);
run("docker", ["compose", "exec", "-T", "postgres", "psql", "-U", "cognicare_owner", "-d", "cognicare", "-f", "/tmp/runtime-grants.sql"]);
run("npm", ["run", "db:seed"]);
console.log("\nStart CogniCare with npm run dev, then open http://localhost:3000.");
