// The real signed-in path (not ?mock): Firebase, Google sign-in and the Calendar
// API are faked with realistic delays (fixtures/signed-in.mjs), so loading jank shows up.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { launch, sleep } from "./browser.mjs";
import { signedIn } from "./fixtures/signed-in.mjs";

const pages = [];
after(async () => { for (const p of pages) { assert.deepEqual(p.errors, [], "no console errors"); await p.close(); } });

// Records, every frame from the first one, what the page shows.
const RECORD = `(() => {
  window.__frames = []; window.__shifts = 0;
  new PerformanceObserver((l) => { for (const e of l.getEntries()) __shifts += e.value; }).observe({ type: "layout-shift", buffered: true });
  const tick = () => {
    const st = document.getElementById("stage");
    if (st) __frames.push({
      titles: [...st.querySelectorAll(".c-title")].map((e) => e.textContent),
      welcome: !document.getElementById("welcome").hidden,
      accounts: document.getElementById("acctBtn").getAttribute("aria-label"),
    });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

async function open(viewport, opts) {
  const fake = signedIn(opts);
  const page = await launch({ viewport, routes: fake.routes });
  pages.push(page);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: fake.setup });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: RECORD });
  await page.goto("#week", { ready: "document.querySelectorAll('.card').length > 3" });
  await sleep(600);
  return page;
}

for (const viewport of ["desktop", "phone"]) {
  test(`${viewport}: a returning user goes straight to their own events, without jumps`, async () => {
    const page = await open(viewport);
    const frames = await page.eval("__frames");
    assert.ok(frames.length > 5);
    assert.ok(!frames.some((f) => f.titles.includes("Family dinner")), "sample events never show");
    assert.ok(!frames.some((f) => f.welcome), "the sign-in card never shows");
    assert.ok(frames.filter((f) => f.accounts).every((f) => f.accounts === "Accounts (2)"), "avatars are there from the start");
    assert.ok(await page.eval("__shifts") < 0.01, "no layout shift");
    const top = await page.eval("document.querySelector('.day.today').getBoundingClientRect().top - document.getElementById('stage').getBoundingClientRect().top");
    assert.ok(top >= 0 && top < 20, `today is at the top (${top}px)`);
  });
}

test("picking a photo for one event doesn't fade the other photos out and in again", async () => {
  const page = await open("desktop");
  await page.eval(`(() => { window.__hidden = 0; const tick = () => {
    const n = [...document.querySelectorAll("#stage .ph")].filter((p) => !p.classList.contains("shown")).length;
    __hidden = Math.max(__hidden, n); requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
  await page.click('.card[data-id="errand"]');
  await page.click("#scope-event + .sc-txt");
  await page.click(".pk-item:nth-child(2)");
  await page.waitFor(`document.querySelector('.card[data-id="errand"] .ph.shown, .card[data-id="errand"] .c-thumb .ph.shown')`);
  assert.ok(await page.eval("__hidden") <= 1, "only the new photo fades in");
});
