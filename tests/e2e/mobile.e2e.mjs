// Phone layout (390x844, touch).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";

let page;
before(async () => { page = await launch({ viewport: "phone" }); await page.goto("?mock#week"); });
after(async () => { assert.deepEqual(page.errors, [], "no console errors"); await page.close(); });

test("nothing overflows horizontally, even with several accounts", async () => {
  await page.tap("#acctBtn");
  await page.tap(".pa-add");
  assert.equal(await page.eval("document.documentElement.scrollWidth <= innerWidth"), true);
  const btn = await page.eval("(() => { const r = document.getElementById('acctBtn').getBoundingClientRect(); return r.right <= innerWidth; })()");
  assert.equal(btn, true);
});

test("swiping left and right moves between weeks without leaving the page", async () => {
  const first = () => page.eval("document.querySelector('.day')?.dataset.day");
  await page.swipe(330, 500, 60, 510);
  await page.waitFor("document.querySelector('.day')?.dataset.day === 'Sun Nov 22 2026'");
  await page.swipe(40, 500, 370, 505);
  await page.waitFor("document.querySelector('.day.today')");
  assert.equal(await first(), "Sun Nov 15 2026");
  assert.match(await page.eval("location.href"), /\?mock#week$/);
});

test("the event panel is a full-width bottom sheet", async () => {
  await page.tap(".card.photo");
  await page.waitFor("document.body.classList.contains('panel-open')");
  // Wait for the slide-in to finish before measuring.
  await page.waitFor("Math.round(document.getElementById('panel').getBoundingClientRect().bottom) === innerHeight");
  const r = await page.eval("(() => { const b = document.getElementById('panel').getBoundingClientRect(); return { left: b.left, width: b.width, bottom: Math.round(b.bottom) }; })()");
  assert.equal(r.left, 0);
  assert.equal(r.width, 390);
  assert.equal(r.bottom, 844);
  await page.tap(".pv-close");
  await page.waitFor("!document.body.classList.contains('panel-open')");
});

test("the accounts menu fits on screen", async () => {
  await page.tap("#acctBtn");
  const fits = await page.eval("(() => { const b = document.getElementById('acctPop').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth; })()");
  assert.equal(fits, true);
});
