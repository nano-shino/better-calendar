import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const html = read("index.html");
const preloaded = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g)].map((m) => m[1]);

test("index.html preloads every module main.js reaches, and nothing else", () => {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of read(file).matchAll(/^import .* from "\.\/([\w-]+\.js)";$/gm)) walk(`js/${m[1]}`);
  };
  walk("js/main.js");
  seen.delete("js/main.js");
  const local = preloaded.filter((p) => !p.startsWith("https:"));
  assert.deepEqual([...local].sort(), [...seen].sort());
  for (const f of readdirSync(new URL("js/", root))) assert.ok(f === "main.js" || seen.has(`js/${f}`), `js/${f} is imported somewhere`);
});

test("the preloaded Firebase modules are the ones store.js imports", () => {
  const v = read("js/store.js").match(/const V = "([\d.]+)"/)[1];
  const fb = preloaded.filter((p) => p.includes("firebasejs"));
  assert.deepEqual(fb, ["app", "auth", "firestore"].map((m) => `https://www.gstatic.com/firebasejs/${v}/firebase-${m}.js`));
});
