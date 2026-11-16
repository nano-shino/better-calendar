// Marking events done (desktop): the panel's Done button, Undo, the Completed tab, keys.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";

let page;
before(async () => { page = await launch(); await page.goto("?mock#week"); });
after(async () => { assert.deepEqual(page.errors, [], "no console errors"); await page.close(); });

const titles = () => page.eval("[...document.querySelectorAll('#stage .c-title')].map((t) => t.textContent)");
const shown = async (title) => (await titles()).includes(title);
// Marking done animates the card away first, so wait for the list to settle on the result.
const has = (title) => `[...document.querySelectorAll('#stage .c-title')].some((t) => t.textContent === ${JSON.stringify(title)})`;
const gone = (title) => page.waitFor(`!${has(title)}`);
const back = (title) => page.waitFor(has(title));
async function cardSel(title) {
  const id = await page.eval(`[...document.querySelectorAll('.card')].find((c) => c.querySelector('.c-title').textContent === ${JSON.stringify(title)})?.dataset.id`);
  assert.ok(id, `card "${title}" exists`);
  return `[data-id="${id}"]`;
}
const badge = () => page.eval("(() => { const b = document.querySelector('#doneBtn .db-n'); return b.hidden ? '' : b.textContent; })()");
// A card in a stack of overlapping events spreads the stack on the first click.
async function open(title) {
  const sel = await cardSel(title);
  if (await page.eval(`!!document.querySelector('${sel}').closest('li[data-run]:not(.dk-open)')`)) await page.click(sel);
  await page.click(sel);
  await page.waitFor("document.body.classList.contains('panel-open')");
}
const tab = () => page.eval("document.getElementById('stage').dataset.tab");

test("Done in the panel hides the event and the Completed tab lists it", async () => {
  await open("Coffee with Alex");
  assert.equal(await page.eval("document.querySelector('.pv-done').textContent"), "Done");
  await page.click(".pv-done");
  await page.waitFor("!document.body.classList.contains('panel-open')");
  await gone("Coffee with Alex");
  assert.equal(await badge(), "1");
  assert.match(await page.eval("document.getElementById('toast').textContent"), /Done: Coffee with Alex/);

  await page.click("#doneBtn");
  assert.equal(await tab(), "done");
  assert.equal(await page.eval("document.getElementById('doneBtn').getAttribute('aria-pressed')"), "true");
  assert.deepEqual(await titles(), ["Coffee with Alex"]);
  const sel = await cardSel("Coffee with Alex");
  assert.match(await page.eval(`document.querySelector('${sel}').getAttribute('aria-label')`), /, done$/);
  // No Now line or free days on the Completed tab: only what was done.
  assert.equal(await page.eval("document.querySelectorAll('.now-mark, .free-run').length"), 0);

  // Not done from the panel puts it back with your plans.
  await open("Coffee with Alex");
  assert.equal(await page.eval("document.querySelector('.pv-done').textContent"), "Not done");
  await page.click(".pv-done");
  await page.waitFor("!document.body.classList.contains('panel-open')");
  await gone("Coffee with Alex");
  assert.match(await page.eval("document.querySelector('.agenda-empty').textContent"), /Nothing done yet/);
  await page.click(".at-back");
  assert.equal(await tab(), "plan");
  await back("Coffee with Alex");
  assert.equal(await badge(), "");
});

test("Undo in the toast brings the event back", async () => {
  await open("Breakfast with Sam");
  await page.click(".pv-done");
  await page.waitFor("!document.body.classList.contains('panel-open')");
  await gone("Breakfast with Sam");
  await page.click(".toast-btn");
  await back("Breakfast with Sam");
  assert.equal(await badge(), "");
});

test("X marks the focused card done and C switches to the Completed tab", async () => {
  const sel = await cardSel("Breakfast with Sam");
  await page.eval(`document.querySelector('${sel}').focus()`);
  await page.key("x");
  await gone("Breakfast with Sam");
  await page.key("c");
  assert.equal(await tab(), "done");
  assert.deepEqual(await titles(), ["Breakfast with Sam"]);
  // In the open panel, X toggles it back.
  await open("Breakfast with Sam");
  await page.key("x");
  await page.waitFor("!document.body.classList.contains('panel-open')");
  await page.waitFor("!document.querySelector('#stage .card')");
  await page.key("c");
  assert.equal(await tab(), "plan");
  await back("Breakfast with Sam");
});

test("done stays done across weeks, and only that occurrence of a repeat", async () => {
  const standups = async () => (await titles()).filter((t) => t === "Team standup").length;
  const before = await standups();
  const sel = await cardSel("Team standup");
  await page.eval(`document.querySelector('${sel}').focus()`);
  await page.key("x");
  await page.waitFor(`[...document.querySelectorAll('#stage .c-title')].filter((t) => t.textContent === 'Team standup').length === ${before - 1}`);
  await page.key("k");
  await page.waitFor("document.querySelector('.day')?.dataset.day === 'Sun Nov 22 2026'");
  await page.key("j");
  await page.waitFor("document.querySelector('.day')?.dataset.day === 'Sun Nov 15 2026'");
  assert.equal(await standups(), before - 1);
});

test("dragging a card sideways with the mouse marks it done, and doesn't open it", async () => {
  const sel = await cardSel("Coffee with Alex");
  const { x, y } = await page.center(sel);
  await page.drag(x + 100, y, x - 250, y + 4);
  await page.waitFor("![...document.querySelectorAll('#stage .c-title')].some((t) => t.textContent === 'Coffee with Alex')");
  assert.equal(await page.eval("document.body.classList.contains('panel-open')"), false);
  await page.click(".toast-btn");
  await page.waitFor("[...document.querySelectorAll('#stage .c-title')].some((t) => t.textContent === 'Coffee with Alex')");
});

test("a short mouse drag springs back, and a plain click still opens the card", async () => {
  const sel = await cardSel("Coffee with Alex");
  const { x, y } = await page.center(sel);
  await page.drag(x, y, x - 40, y);
  await page.settle();
  assert.ok(await shown("Coffee with Alex"));
  assert.equal(await page.eval(`document.querySelector('${sel}').style.transform`), "");
  assert.equal(await page.eval("document.body.classList.contains('panel-open')"), false);
  await page.click(sel);
  await page.waitFor("document.body.classList.contains('panel-open')");
  await page.key("Escape");
  await page.waitFor("!document.body.classList.contains('panel-open')");
});

test("a two-finger trackpad swipe over a card marks it done; vertical scrolling doesn't", async () => {
  const sel = await cardSel("Coffee with Alex");
  const { x, y } = await page.center(sel);
  await page.wheel(x, y, 0, 120);
  await page.settle();
  assert.ok(await shown("Coffee with Alex"));
  const at = await page.center(sel);
  await page.wheel(at.x, at.y, 300);
  await page.waitFor("![...document.querySelectorAll('#stage .c-title')].some((t) => t.textContent === 'Coffee with Alex')");
  await page.click(".toast-btn");
  await page.waitFor("[...document.querySelectorAll('#stage .c-title')].some((t) => t.textContent === 'Coffee with Alex')");
});

test("marking done doesn't make the list jump: the cards below glide up", async () => {
  await page.settle();
  const gone = await cardSel("Coffee with Alex");
  const below = await cardSel("Gym");
  // Track where the card below is drawn on every frame (re-found each frame, since the list re-renders).
  await page.eval(`(() => {
    window.__tops = [];
    const tick = () => {
      const el = document.querySelector('${below}');
      if (el) __tops.push(el.getBoundingClientRect().top);
      if (__tops.length < 120) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return 1;
  })()`);
  await page.eval(`document.querySelector('${gone}').focus()`);
  await page.key("x");
  await page.waitFor("window.__tops.length >= 60");
  const tops = await page.eval("window.__tops");
  const total = Math.abs(tops[0] - tops[tops.length - 1]);
  const step = Math.max(...tops.slice(1).map((t, i) => Math.abs(t - tops[i])));
  assert.ok(total > 100, `the card below moved up (${total}px)`);
  assert.ok(step < total * 0.4, `no single frame moved it more than 40% of the way (biggest ${step.toFixed(1)}px of ${total.toFixed(1)}px)`);
  await page.click(".toast-btn");
  await page.waitFor("[...document.querySelectorAll('#stage .c-title')].some((t) => t.textContent === 'Coffee with Alex')");
});
