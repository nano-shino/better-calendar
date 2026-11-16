// Starts the static server, then runs every tests/e2e/*.e2e.mjs file with node:test.
//   npm run test:e2e                       -> all browser tests
//   npm run test:e2e -- panel              -> only files whose name contains "panel"
//
// Nothing may hang the run. Each test fails after TEST_MS (node:test's own timeout,
// which also covers before/after hooks such as launching Chrome). Each file runs in its
// own process, killed after FILE_MS, so a hang outside any test (a stuck CDP call, a
// Chrome that never exits) fails that file by name and the run moves on.
// The slowest test takes about 3 s and the slowest file about 16 s.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startServer } from "../serve.mjs";

const TEST_MS = Number(process.env.E2E_TEST_MS) || 15_000;
const FILE_MS = Number(process.env.E2E_FILE_MS) || 120_000;

const dir = fileURLToPath(new URL(".", import.meta.url));
const filter = process.argv[2] || "";
const files = readdirSync(dir).filter((f) => f.endsWith(".e2e.mjs") && f.includes(filter));
if (!files.length) { console.error("No e2e files match", filter); process.exit(1); }

const server = await startServer(0);

function killTree(child) {
  if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
}

function runFile(file) {
  return new Promise((done) => {
    // Its own process group (POSIX), so the watchdog can stop the Chrome it launched too.
    const child = spawn(process.execPath, ["--test", `--test-timeout=${TEST_MS}`, dir + file], {
      stdio: "inherit",
      detached: process.platform !== "win32",
      env: { ...process.env, BASE_URL: server.url },
    });
    const timer = setTimeout(() => {
      console.error(`\n✖ ${file} timed out after ${FILE_MS / 1000} s; stopping it and its browser.`);
      killTree(child);
    }, FILE_MS);
    child.on("exit", (code, signal) => { clearTimeout(timer); done(signal ? 1 : code ?? 1); });
  });
}

const failed = [];
for (const f of files) if (await runFile(f)) failed.push(f);
await server.close();
if (failed.length) console.error(`\n✖ failed: ${failed.join(", ")}`);
process.exit(failed.length ? 1 : 0);
