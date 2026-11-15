// worker/server.mjs: the token Worker run as a plain Node server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { start, fileKV } from "../../worker/server.mjs";

const env = {
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "s", FIREBASE_PROJECT_ID: "p", FIREBASE_API_KEY: "k",
  TOKEN_KEY: Buffer.alloc(32, 1).toString("base64"), ALLOWED_ORIGINS: "https://site.example",
};

// node:http, not fetch, so nothing here touches the global fetch the Worker uses.
const post = (port, path, origin, body) => new Promise((resolve, reject) => {
  const req = request({ host: "127.0.0.1", port, path, method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" } }, (res) => {
    let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
  });
  req.on("error", reject); req.end(body);
});

test("refuses to start without its settings", () => {
  assert.throws(() => start({ port: 0, env: { ...env, GOOGLE_CLIENT_SECRET: "" } }), /GOOGLE_CLIENT_SECRET/);
});

test("serves the Worker: origin check, CORS, auth", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bc-srv-"));
  const server = await start({ port: 0, env: { ...env, TOKENS: fileKV(join(dir, "t.json")) } });
  const { port } = server.address();
  try {
    assert.equal((await post(port, "/token", "https://evil.example", "{}")).status, 403);
    const r = await post(port, "/token", "https://site.example", JSON.stringify({ idToken: "bad", email: "a@x.com" }));
    assert.equal(r.status, 401);
    assert.equal(r.headers["access-control-allow-origin"], "https://site.example");
    assert.equal(JSON.parse(r.body).error, "auth");
    assert.equal((await post(port, "/token", "https://site.example", "x".repeat(20000))).status, 413);
  } finally { server.close(); }
});

test("the file store survives a restart and is private", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "bc-kv-")), "t.json");
  const kv = fileKV(file);
  await kv.put("rt:u:a@x.com", "sealed");
  await kv.put("rt:u:b@x.com", "other");
  await kv.delete("rt:u:b@x.com");
  assert.equal(await fileKV(file).get("rt:u:a@x.com"), "sealed");
  assert.equal(await fileKV(file).get("rt:u:b@x.com"), null);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(file, "utf8"))), ["rt:u:a@x.com"]);
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
});
