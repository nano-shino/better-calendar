// Starts the static server, then runs every tests/e2e/*.e2e.mjs file with node:test.
//   npm run test:e2e                       -> all browser tests
//   npm run test:e2e -- panel              -> only files whose name contains "panel"
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "../serve.mjs";

const dir = fileURLToPath(new URL(".", import.meta.url));
const filter = process.argv[2] || "";
const files = readdirSync(dir).filter((f) => f.endsWith(".e2e.mjs") && f.includes(filter)).map((f) => dir + f);
if (!files.length) { console.error("No e2e files match", filter); process.exit(1); }

const server = await startServer(0);
const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
  stdio: "inherit",
  env: { ...process.env, BASE_URL: server.url },
});
child.on("exit", async (code) => { await server.close(); process.exit(code ?? 1); });
