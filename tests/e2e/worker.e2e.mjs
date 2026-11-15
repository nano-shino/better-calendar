// The token Worker path (real boot, not ?mock): background token refreshes,
// one popup to sign in, the quota rules, and falling back when Cloudflare
// rate-limits the Worker. Fakes are in fixtures/signed-in.mjs.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { launch, sleep } from "./browser.mjs";
import { signedIn } from "./fixtures/signed-in.mjs";

const pages = [];
after(async () => { for (const p of pages) { assert.deepEqual(p.errors, [], "no console errors"); await p.close(); } });

async function open(opts, ready = "document.querySelectorAll('.card').length > 3") {
  const fake = signedIn(opts);
  const page = await launch({ routes: fake.routes });
  pages.push(page);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: fake.setup });
  await page.goto("#week", { ready });
  await sleep(600); // let idle prefetching run too
  return { page, fake };
}
const tokenCalls = (fake) => fake.workerCalls.filter((c) => c.path === "/token");
const bannerShown = (page) => page.eval("!document.getElementById('banner').hidden");

test("expired tokens are renewed in the background: no Reconnect, one Worker call per account", async () => {
  const { page, fake } = await open({ expired: ["me@example.com", "work@example.com"], worker: { mode: "ok" } });
  assert.equal(await bannerShown(page), false);
  const text = await page.eval("document.getElementById('stage').textContent");
  assert.ok(text.includes("Lunch with Ana") && text.includes("Quarter planning"), "both accounts' events load");
  assert.deepEqual(tokenCalls(fake).map((c) => c.email).sort(), ["me@example.com", "work@example.com"]);
  assert.ok(tokenCalls(fake).every((c) => c.idToken === "fbtok-u"), "each call proves who is asking");
  assert.ok(fake.workerCalls.every((c) => c.method === "POST" && c.type.startsWith("text/plain")), "simple requests: no CORS preflight");
});

test("a burst of Calendar calls without a token makes one Worker call", async () => {
  const { page, fake } = await open({ worker: { mode: "ok" } });
  const before = tokenCalls(fake).length;
  await page.eval(`(async () => {
    const g = await import(new URL("js/google.js", location.href));
    localStorage.removeItem("bd:tok:work@example.com");
    await Promise.all(Array.from({ length: 10 }, () => g.listCalendars("work@example.com")));
  })()`);
  assert.equal(tokenCalls(fake).length - before, 1);
});

test("when Cloudflare rate-limits the Worker, the app falls back to Reconnect and leaves the Worker alone", async () => {
  const { page, fake } = await open({ expired: ["work@example.com"], worker: { mode: "limited" } });
  assert.equal(await bannerShown(page), true);
  assert.match(await page.eval("document.getElementById('banner').textContent"), /work@example\.com/);
  assert.equal(tokenCalls(fake).length, 1, "asked once, then stopped");
  const until = await page.eval("JSON.parse(localStorage.getItem('bd:workerDown'))");
  assert.equal(new Date(until).toISOString().slice(11), "00:00:00.000Z", "skipped until the daily reset (00:00 UTC)");

  await page.key("ArrowRight"); await sleep(700);
  await page.key("ArrowLeft"); await sleep(700);
  assert.equal(fake.workerCalls.length, 1, "navigating doesn't call the Worker again");

  // Reconnect uses the old one-hour popup, which still works without the Worker.
  await page.click("#banner .btn");
  await page.waitFor("document.getElementById('banner').hidden");
  assert.deepEqual(await page.eval("__popups"), { firebase: 0, code: 0, token: 1 });
  assert.equal(fake.workerCalls.length, 1);
  assert.ok((await page.eval("document.getElementById('stage').textContent")).includes("Team standup"));
});

test("an account the Worker doesn't know shows Reconnect once, and one popup connects it for good", async () => {
  const { page, fake } = await open({ expired: ["work@example.com"], worker: { mode: "reauth" } });
  assert.equal(await bannerShown(page), true);
  await page.key("ArrowRight"); await sleep(700);
  assert.equal(tokenCalls(fake).length, 1, "a refused account isn't asked about again");

  await page.click("#banner .btn");
  await page.waitFor("document.getElementById('banner').hidden");
  assert.deepEqual(await page.eval("__popups"), { firebase: 0, code: 1, token: 0 });
  const connect = fake.workerCalls.find((c) => c.path === "/connect");
  assert.equal(connect.code, "code-work@example.com");
  assert.equal(connect.idToken, "fbtok-u", "linked to the signed-in user");
});

test("signing in takes one popup, and Firebase signs in from it without another", async () => {
  const { page, fake } = await open({ signedOut: true, worker: { mode: "ok" } }, "!document.getElementById('welcome').hidden");
  await page.click("#welcome .btn.primary");
  await page.waitFor("document.getElementById('welcome').hidden && document.getElementById('stage').textContent.includes('Lunch with Ana')", { timeout: 8000 });
  assert.deepEqual(await page.eval("__popups"), { firebase: 0, code: 1, token: 0 });
  const connect = fake.workerCalls.find((c) => c.path === "/connect");
  assert.equal(connect.idToken, undefined, "a sign-in, not a link");
  await sleep(600);
  assert.equal(await bannerShown(page), false, "the other linked account renews in the background too");
});

test("removing an account tells the Worker to forget it", async () => {
  const { page, fake } = await open({ worker: { mode: "ok" } });
  await page.click("#acctBtn");
  await page.eval("[...document.querySelectorAll('.link-btn')].find((b) => b.textContent === 'Remove').setAttribute('data-test', 'rm')");
  await page.click("[data-test=rm]");
  await sleep(300);
  const d = fake.workerCalls.find((c) => c.path === "/disconnect");
  assert.ok(d, "called /disconnect");
  assert.equal(d.idToken, "fbtok-u");
});
