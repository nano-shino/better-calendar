// Views, navigation, keyboard shortcuts and the Today button.
// Clock: Mon 2026-11-16 10:00, en-US (weeks start Sunday), so this week is Nov 15–21.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch, sleep } from "./browser.mjs";

let page;
before(async () => { page = await launch(); await page.goto("?mock"); });
after(async () => { assert.deepEqual(page.errors, [], "no console errors"); await page.close(); });

const firstDay = () => page.eval("document.querySelector('.day, .free-run') && (document.querySelector('.day')?.dataset.day)");

test("opens on the current week with the right title and hash", async () => {
  const s = await page.state();
  assert.equal(s.view, "week");
  assert.equal(s.title, "November 2026");
  assert.equal(s.hash, "#week");
  assert.equal(s.days[0], "Sun Nov 15 2026");
});

test("switches views with the segmented control, keys and the address hash", async () => {
  await page.click('#seg [data-v="day"]');
  await page.waitFor("document.querySelector('#stage').dataset.view === 'day'");
  assert.equal((await page.state()).hash, "#day");
  await page.key("m");
  await page.waitFor("document.querySelector('#stage').dataset.view === 'month'");
  await page.eval("location.hash = '#week'");
  await page.waitFor("document.querySelector('#stage').dataset.view === 'week'");
  assert.equal(await page.eval("document.querySelector('#seg [aria-pressed=true]').dataset.v"), "week");
});

test("switching between Week and Month only fades: today's cards don't move", async () => {
  const card = () => page.eval("Math.round(document.querySelector('.day.today .card').getBoundingClientRect().top)");
  const before = await card();
  await page.click('#seg [data-v="month"]');
  await page.waitFor("document.querySelector('#stage').dataset.view === 'month'");
  // Sample through the animation: the card must never be anywhere else.
  const tops = [];
  for (let i = 0; i < 8; i++) { tops.push(await card()); await sleep(30); }
  assert.deepEqual([...new Set(tops)], [before]);
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#stage > .agenda')).transform"), "none");
  await page.click('#seg [data-v="week"]');
  await page.waitFor("document.querySelector('#stage').dataset.view === 'week'");
  assert.equal(await card(), before);
});

test("fast clicks on Next are never lost (no overlay blocks input mid-animation)", async () => {
  const { x, y } = await page.center("#nextBtn");
  for (let i = 0; i < 4; i++) { await page.clickAt(x, y); await sleep(60); }
  await page.waitFor("document.querySelector('.day')?.dataset.day === 'Sun Dec 13 2026' || document.querySelector('.free-run')");
  await sleep(300);
  assert.equal(await page.eval("document.querySelector('#title').textContent"), "December 2026");
});

test("Today returns to the current week", async () => {
  await page.click("#todayBtn");
  await page.waitFor("document.querySelector('.day.today')");
  assert.equal(await firstDay(), "Sun Nov 15 2026");
});

test("a week spanning two months shows both in the title", async () => {
  for (let i = 0; i < 2; i++) await page.key("ArrowRight");
  await page.waitFor("document.querySelector('#title').textContent === 'Nov – Dec 2026'");
  await page.key("t");
  await page.waitFor("document.querySelector('.day.today')");
});

test("clicking a day's date opens that day", async () => {
  await page.click('[data-day="Thu Nov 19 2026"] .day-h');
  await page.waitFor("document.querySelector('#stage').dataset.view === 'day'");
  assert.deepEqual((await page.state()).days, ["Thu Nov 19 2026"]);
  await page.key("w");
  await page.waitFor("document.querySelector('#stage').dataset.view === 'week'");
});

test("month view lists only days with events (plus today)", async () => {
  await page.key("m");
  await page.waitFor("document.querySelector('#stage').dataset.view === 'month'");
  const days = (await page.state()).days;
  assert.ok(days.includes("Mon Nov 16 2026"));
  assert.ok(days.every((d) => d.includes("Nov")), "only November days");
  await page.key("w");
});

test("the title animates only when its words change", async () => {
  await page.eval("location.hash = '#week'; location.reload()");
  await sleep(300);
  await page.waitFor("document.getElementById('title').textContent === 'November 2026' && document.querySelector('.card')");
  await page.settle();
  const titleAnimating = () => page.eval("document.getElementById('title').getAnimations().length > 0");
  await page.key("ArrowRight"); // Nov 22–28: still "November 2026"
  await page.waitFor("document.querySelector('.day, .free-run')?.textContent.includes('22')");
  assert.equal(await titleAnimating(), false);
  await page.key("ArrowRight"); // Nov 29 – Dec 5
  await page.waitFor("document.getElementById('title').textContent === 'Nov – Dec 2026'");
  assert.equal(await titleAnimating(), true);
});
