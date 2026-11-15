// How events are laid out in the list: photo cards, compact rows, Now line, free days.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";

let page;
before(async () => { page = await launch(); await page.goto("?mock#week"); });
after(async () => { assert.deepEqual(page.errors, [], "no console errors"); await page.close(); });

const cardsTitled = (t) => page.eval(`[...document.querySelectorAll('.card')].filter((c) => c.querySelector('.c-title').textContent === ${JSON.stringify(t)}).map((c) => c.className)`);

test("a repeating event gets one big photo card per week; the rest are compact rows", async () => {
  const standups = await cardsTitled("Team standup");
  assert.equal(standups.length, 5);
  assert.equal(standups.filter((c) => c.includes("photo")).length, 1);
  // Monday's 9:30 standup is over at 10:00, so Tuesday's is the big one.
  const bigDay = await page.eval("[...document.querySelectorAll('.card.photo')].find((c) => c.textContent.includes('Team standup')).closest('.day').dataset.day");
  assert.equal(bigDay, "Tue Nov 17 2026");
});

test("events whose title doesn't name a kind of event stay plain (no guessed photo)", async () => {
  const [planning] = await cardsTitled("Quarterly planning");
  assert.match(planning, /plain/);
  assert.match(planning, /has-thumb/); // lettered tile keeps titles aligned
  assert.equal(await page.eval("document.querySelector('.card .c-tile') !== null"), true);
});

test("events with a clear kind get an automatic photo", async () => {
  for (const t of ["Coffee with Alex", "Dentist", "Flight to Lisbon"]) {
    const [cls] = await cardsTitled(t);
    assert.match(cls, /photo/, t);
  }
});

test("today shows a Now line between past and upcoming events", async () => {
  const order = await page.eval("[...document.querySelectorAll('.day.today .cards > li')].map((li) => li.classList.contains('now-mark') ? 'NOW' : li.querySelector('.c-title').textContent)");
  assert.deepEqual(order, ["Team standup", "NOW", "Coffee with Alex", "Gym"]);
  assert.match(await page.eval("document.querySelector('.day.today .card').className"), /past/);
});

test("a multi-day all-day event appears once, on its first day in range", async () => {
  const trips = await page.eval("[...document.querySelectorAll('.card')].filter((c) => c.textContent.includes('Trip to Portugal')).map((c) => c.closest('.day').dataset.day)");
  assert.deepEqual(trips, ["Fri Nov 20 2026"]);
  await page.key("ArrowRight");
  await page.waitFor("document.querySelector('.day')?.dataset.day === 'Sun Nov 22 2026'");
  assert.match(await page.eval("document.querySelector('[data-day=\"Sun Nov 22 2026\"]').textContent"), /Trip to Portugal/);
  await page.key("t");
  await page.waitFor("document.querySelector('.day.today')");
});

test("consecutive free days collapse into one row", async () => {
  // Hide every calendar except Family: only Sun (dinner) and Fri/Sat (trip) keep events.
  await page.click("#acctBtn");
  for (const name of ["Work", "Personal"]) {
    const id = await page.eval(`[...document.querySelectorAll('.cal')].find((l) => l.textContent.includes(${JSON.stringify(name)})).getAttribute('for')`);
    await page.click(`label[for="${id}"]`);
  }
  await page.key("Escape");
  const free = await page.eval("[...document.querySelectorAll('.free-run .fr-days')].map((e) => e.textContent)");
  assert.deepEqual(free, ["17–19 Nov"]);
  assert.equal(await page.eval("document.querySelector('.day.today .day-empty').textContent"), "Nothing planned today");
});
