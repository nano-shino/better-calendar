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
  // ...and the photo actually loads and shows (not the colour fallback).
  await page.waitFor("[...document.querySelectorAll('.card.photo')].every((c) => c.querySelector(':scope > .c-art > .ph.shown'))");
  assert.equal(await page.eval("document.querySelectorAll('.card.no-photo').length"), 0);
});

test("photo cards show the whole 16:9 photo beside the text, over a blurred copy", async () => {
  await page.waitFor("[...document.querySelectorAll('.card.photo .c-glow')].every((g) => getComputedStyle(g).opacity === '1')");
  const cards = await page.eval(`[...document.querySelectorAll('.card.photo')].map((c) => {
    const art = c.querySelector('.c-art').getBoundingClientRect(), body = c.querySelector('.c-body').getBoundingClientRect();
    return { ratio: art.width / art.height, beside: body.left >= art.right, ph: c.querySelector('.c-art > .ph').style.backgroundImage,
      glow: c.querySelector('.c-glow').style.backgroundImage };
  })`);
  assert.ok(cards.length > 0);
  for (const c of cards) {
    assert.ok(Math.abs(c.ratio - 16 / 9) < 0.05, `16:9, got ${c.ratio}`);
    assert.ok(c.beside, "text sits beside the photo, not on it");
    assert.equal(c.glow, c.ph);
  }
});

test("today shows a Now line between past and upcoming events", async () => {
  const order = await page.eval("[...document.querySelectorAll('.day.today .cards > li')].map((li) => li.classList.contains('now-mark') ? 'NOW' : li.classList.contains('now-gap') ? 'GAP' : li.classList.contains('part-mark') ? li.querySelector('.pm-label').textContent : li.querySelector('.c-title').textContent)");
  assert.deepEqual(order, ["Team standup", "NOW", "GAP", "Noon", "Coffee with Alex", "Evening", "Gym"]);
  assert.match(await page.eval("document.querySelector('.day.today .card').className"), /past/);
});

test("a countdown thread bridges the Now line and the next event", async () => {
  const gap = await page.eval(`(() => {
    const g = document.querySelector('.day.today .now-gap'), next = g.parentElement.querySelector('.now-gap ~ li .card');
    const now = document.querySelector('.day.today .now-mark').getBoundingClientRect(), r = g.getBoundingClientRect();
    return { left: g.querySelector('.ng-left').textContent, until: g.querySelector('.ng-until').textContent,
      label: g.getAttribute('aria-label'), soon: g.classList.contains('soon'), h: r.height,
      below: r.top >= now.bottom - 6 && r.bottom <= next.getBoundingClientRect().top + 6 };
  })()`);
  // 10:00 now, Coffee with Alex at 15:00.
  assert.equal(gap.left, "5h");
  assert.equal(gap.until, "until Coffee with Alex");
  assert.equal(gap.label, "5 h until Coffee with Alex");
  assert.ok(!gap.soon);
  assert.ok(gap.below, "sits between the Now line and the card");
  assert.ok(gap.h > 70 && gap.h < 95, `a long wait makes a tall gap, got ${gap.h}`);
  // Only today has one: other days have no "now".
  assert.equal(await page.eval("document.querySelectorAll('.now-gap').length"), 1);
});

test("Noon and Evening markers sit before the first event of each part of the day", async () => {
  const marks = await page.eval(`[...document.querySelectorAll('.day')].map((d) => [d.dataset.day,
    [...d.querySelectorAll('.cards > li')].map((li) => li.classList.contains('part-mark') ? li.querySelector('.pm-label').textContent
      : li.querySelector('.c-title')?.textContent).filter(Boolean).join(' / ')])`);
  const by = Object.fromEntries(marks);
  // 10:00-12:00 then 12:00 lunch: noon falls between them. Mornings get no marker.
  assert.equal(by["Tue Nov 17 2026"], "Team standup / Quarterly planning / Noon / Lunch with the team / 1:1 with Sam");
  // Markers go by start time: a morning flight running past noon adds none. All-day events don't count.
  assert.equal(by["Fri Nov 20 2026"], "Trip to Portugal / Flight to Lisbon / Team standup / Evening / Gym / Seafood dinner");
  // A day whose first event is in the evening still says so.
  assert.equal(by["Sun Nov 15 2026"], "Evening / Family dinner");
  assert.equal(by["Thu Nov 19 2026"], "Team standup / Noon / Design review");
  // At 10:00 today's Noon is still ahead, so it isn't dimmed.
  assert.equal(await page.eval("document.querySelector('.day.today .pm-noon').classList.contains('past')"), false);
  assert.equal(await page.eval("document.querySelector('.day.today .pm-noon').getAttribute('aria-label')"), "Noon, from 12:00 PM");
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
