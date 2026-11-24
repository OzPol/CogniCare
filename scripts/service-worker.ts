import { randomUUID } from "node:crypto";
import { build } from "esbuild";

await build({
  entryPoints: ["src/shared/service-worker.ts"],
  outfile: "public/sw.js",
  bundle: true,
  platform: "browser",
  target: ["es2022"],
  minify: true,
  define: { __COGNICARE_CACHE__: JSON.stringify("cognicare-shell-" + randomUUID()) },
});
