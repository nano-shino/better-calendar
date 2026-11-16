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
  page.fake = fake;
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

test("Day, Week and Month for the same dates come from one request: switching waits for nothing", async () => {
  const page = await open("desktop");
  const calls = page.fake.calendarCalls;
  // Let the idle prefetch of the months either side start and settle.
  let n = -1;
  while (n !== calls.length) { n = calls.length; await sleep(700); }
  const view = (v) => `document.getElementById('stage').dataset.view === '${v}' && !document.body.classList.contains('loading') && document.querySelectorAll('.card').length > 0`;
  for (const [key, v] of [["m", "month"], ["d", "day"], ["m", "month"], ["w", "week"]]) {
    await page.key(key);
    await page.waitFor(view(v), { timeout: 300, interval: 10 });
  }
  await page.key("k"); // the week after, still in November's block
  await sleep(100);
  assert.equal(calls.length, n, "no new Calendar requests");
});

test("a reload asks for events at once, without waiting for the calendar list", async () => {
  const page = await open("desktop");
  const calls = page.fake.calendarCalls;
  await sleep(800);
  calls.length = 0;
  await page.send("Page.reload", {});
  await page.waitFor("document.querySelectorAll('.card').length > 3", { timeout: 10000 });
  const list = calls.find((c) => c.path.endsWith("/calendarList"));
  const events = calls.filter((c) => c.path.endsWith("/events"));
  assert.ok(events.length >= 3);
  assert.ok(events[0].at < list.done, "events were asked for before the list came back");
  assert.ok(await page.eval(`!!document.querySelector('.card[data-id="lunch"]')`), "the user's own events show");
});

test("events without a title read as Busy or No title, with a hatched tile instead of a letter", async () => {
  const page = await open("desktop");
  const cardOf = (id) => page.eval(`(() => { const c = document.querySelector('.card[data-id="${id}"]');
    const t = c.querySelector('.c-tile'); return { title: c.querySelector('.c-title').textContent, blank: !!t?.classList.contains('c-tile-blank'), letter: t?.textContent ?? null, photo: !!c.querySelector('.ph, .c-thumb') }; })()`);
  assert.deepEqual(await cardOf("busy17"), { title: "Busy", blank: true, letter: "", photo: false });
  assert.deepEqual(await cardOf("blank"), { title: "No title", blank: true, letter: "", photo: false });
  assert.equal((await cardOf("plan")).letter, "Q");

  await page.click('.card[data-id="busy17"]');
  await page.waitFor("document.getElementById('pvTitle')?.textContent === 'Busy'");
  assert.match(await page.eval("document.querySelector('.pv-hidden-note').textContent"), /^Partner shares only when it's busy/);
  assert.equal(await page.eval("!!document.querySelector('.panel .scope, .panel .pk-grid')"), false, "no photo picker for a busy block");
});

test("an untitled event of your own keeps the photo picker, without the keyword option", async () => {
  const page = await open("desktop");
  await page.click('.card[data-id="blank"]');
  await page.waitFor("document.getElementById('pvTitle')?.textContent === 'No title'");
  assert.equal(await page.eval("!!document.getElementById('scope-event')"), true);
  assert.equal(await page.eval("!!document.getElementById('scope-keyword')"), false);
  assert.equal(await page.eval("document.getElementById('pkQuery').value"), "", "no search for the words 'No title'");
});

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

test("a first visit starts with an empty calendar, and the demo survives a reload", async () => {
  const fake = signedIn({ signedOut: true });
  const page = await launch({ routes: fake.routes });
  pages.push(page);
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: fake.setup });
  await page.goto("#week", { ready: "!document.getElementById('welcome').hidden && !!document.querySelector('.agenda-empty')" });
  assert.equal(await page.eval("document.querySelectorAll('.card').length"), 0, "no sample events");
  await page.click("#welcome .wc-demo");
  await page.waitFor("document.querySelectorAll('.card').length > 0");
  await page.goto("#week", { ready: "document.querySelectorAll('.card').length > 0" });
  assert.equal(await page.eval("document.querySelector('#welcome .wc-demo').textContent"), "Exit demo");
});
