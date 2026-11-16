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
  // Across a day header: a swipe on a card marks it done instead (see below).
  const { y } = await page.center(".day.today .day-h");
  await page.swipe(330, y, 60, y + 4);
  await page.waitFor("document.querySelector('.day')?.dataset.day === 'Sun Nov 22 2026'");
  const back = await page.center(".day-h");
  await page.swipe(40, back.y, 370, back.y + 4);
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

// ---- swipe a card to mark it done ----
const titles = () => page.eval("[...document.querySelectorAll('#stage .c-title')].map((t) => t.textContent)");
async function cardSel(title) {
  const id = await page.eval(`[...document.querySelectorAll('.card')].find((c) => c.querySelector('.c-title').textContent === ${JSON.stringify(title)})?.dataset.id`);
  assert.ok(id, `card "${title}" exists`);
  return `[data-id="${id}"]`;
}
async function closeAll() {
  await page.key("Escape");
  await page.waitFor("!document.body.classList.contains('panel-open') && document.getElementById('acctPop').hidden");
}

test("a short sideways drag on a card springs back without opening it", async () => {
  await closeAll();
  const sel = await cardSel("Coffee with Alex");
  const { x, y } = await page.center(sel);
  await page.swipe(x + 60, y, x + 10, y);
  await page.settle();
  assert.equal(await page.eval(`document.querySelector('${sel}').style.transform`), "");
  assert.equal(await page.eval("document.querySelectorAll('.sw-under').length"), 0);
  assert.equal(await page.eval("document.body.classList.contains('panel-open')"), false);
  assert.ok((await titles()).includes("Coffee with Alex"));
});

test("scrolling with a finger on a card scrolls, it doesn't mark it done", async () => {
  const sel = await cardSel("Coffee with Alex");
  const { x, y } = await page.center(sel);
  const top = await page.eval("document.getElementById('stage').scrollTop");
  await page.swipe(x, y, x + 12, y - 200);
  await page.settle();
  assert.notEqual(await page.eval("document.getElementById('stage').scrollTop"), top);
  assert.ok((await titles()).includes("Coffee with Alex"));
});

test("swiping a card away marks it done; swiping it on the Completed tab undoes that", async () => {
  const sel = await cardSel("Coffee with Alex");
  const { y } = await page.center(sel);
  await page.swipe(330, y, 60, y + 6);
  await page.waitFor("![...document.querySelectorAll('#stage .c-title')].some((t) => t.textContent === 'Coffee with Alex')");
  assert.equal(await page.eval("document.body.classList.contains('panel-open')"), false, "the swipe doesn't open the card");
  assert.equal(await page.eval("document.querySelector('#doneBtn .db-n').textContent"), "1");
  assert.equal(await page.eval("document.documentElement.scrollWidth <= innerWidth"), true);

  await page.tap("#doneBtn");
  await page.waitFor("document.getElementById('stage').dataset.tab === 'done'");
  const done = await cardSel("Coffee with Alex");
  const at = await page.center(done);
  await page.swipe(100, at.y, 370, at.y);
  await page.waitFor("!document.querySelector('#stage .card')");
  await page.tap(".at-back");
  await page.waitFor("document.getElementById('stage').dataset.tab === 'plan'");
  assert.ok((await titles()).includes("Coffee with Alex"));
});

test("pulling the event sheet down closes it", async () => {
  await page.tap(await cardSel("Coffee with Alex"));
  await page.waitFor("document.body.classList.contains('panel-open')");
  await page.waitFor("Math.round(document.getElementById('panel').getBoundingClientRect().bottom) === innerHeight");
  const top = await page.eval("document.getElementById('panel').getBoundingClientRect().top");
  await page.swipe(195, top + 60, 195, top + 360, 10);
  await page.waitFor("!document.body.classList.contains('panel-open')");
  await page.waitFor("document.getElementById('panel').hidden");
  assert.equal(await page.eval("document.getElementById('panel').style.transform"), "");
});

test("a small pull on the sheet snaps it back open", async () => {
  await page.tap(await cardSel("Coffee with Alex"));
  await page.waitFor("document.body.classList.contains('panel-open')");
  await page.waitFor("Math.round(document.getElementById('panel').getBoundingClientRect().bottom) === innerHeight");
  const top = await page.eval("document.getElementById('panel').getBoundingClientRect().top");
  await page.swipe(195, top + 60, 195, top + 100, 4);
  await page.settle();
  await page.waitFor("Math.round(document.getElementById('panel').getBoundingClientRect().bottom) === innerHeight");
  assert.equal(await page.eval("document.body.classList.contains('panel-open')"), true);
  await page.tap(".pv-close");
  await page.waitFor("!document.body.classList.contains('panel-open')");
});
