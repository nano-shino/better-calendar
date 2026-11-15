// Runs the token Worker (index.js) as a plain Node server, for hosting it on
// your own machine instead of Cloudflare. Node >= 22, nothing to install.
//
//   node --env-file=.env server.mjs
//
// Settings come from the environment, with the same names as wrangler.toml and
// its secrets, plus:
//   PORT       default 8787
//   HOST       default 127.0.0.1 (put an HTTPS reverse proxy in front; see docs/SETUP.md)
//   DATA_FILE  default ./tokens.json  where the encrypted refresh tokens are kept
//
// The browser reaches it from https://<you>.github.io, so it must be served
// over HTTPS: browsers block calls from an HTTPS page to plain HTTP.

import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker from "./index.js";

const REQUIRED = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "FIREBASE_PROJECT_ID", "FIREBASE_API_KEY", "TOKEN_KEY", "ALLOWED_ORIGINS"];

// The part of Cloudflare's KV API the Worker uses, kept in one JSON file.
// Writes happen only when an account connects or disconnects, so rewriting the
// whole file (atomically, via rename) is fine.
export function fileKV(file) {
  const data = new Map(existsSync(file) ? Object.entries(JSON.parse(readFileSync(file, "utf8") || "{}")) : []);
  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(data)), { mode: 0o600 });
    renameSync(tmp, file);
    try { chmodSync(file, 0o600); } catch {}
  };
  return {
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => { data.set(k, v); save(); },
    delete: async (k) => { if (data.delete(k)) save(); },
  };
}

export function start({ port = 8787, host = "127.0.0.1", env }) {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing settings: ${missing.join(", ")}`);
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > 16 * 1024) { res.writeHead(413).end(); return; } // bodies are a few KB at most
        chunks.push(c);
      }
      const headers = new Headers();
      for (const k of ["origin", "content-type"]) if (req.headers[k]) headers.set(k, req.headers[k]);
      const request = new Request(new URL(req.url, "http://localhost"), {
        method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const r = await worker.fetch(request, env);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
    } catch (err) {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const e = process.env;
  const env = { ...e, TOKENS: fileKV(e.DATA_FILE || "tokens.json") };
  const server = await start({ port: Number(e.PORT || 8787), host: e.HOST || "127.0.0.1", env });
  const a = server.address();
  console.log(`Token server on http://${a.address}:${a.port}, allowing ${e.ALLOWED_ORIGINS}`);
}
