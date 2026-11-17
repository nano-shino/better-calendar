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
  assert.match(planning, /has-thumb/); // the calendar tile keeps titles aligned
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
  const cards = await page.eval(`[...document.querySelectorAll('.card.photo')].filter((c) => c.checkVisibility()).map((c) => {
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
  assert.deepEqual(order, ["Breakfast with Sam", "Team standup", "NOW", "GAP", "Noon", "Coffee with Alex", "Evening", "Gym"]);
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
  assert.equal(by["Tue Nov 17 2026"], "Team standup / Quarterly planning / Call with Jo / Noon / Lunch with the team / 1:1 with Sam");
  // Markers go by start time: a morning flight running past noon adds none. All-day events don't count.
  assert.equal(by["Fri Nov 20 2026"], "Trip to Portugal / Flight to Lisbon / Team standup / Evening / Gym / Seafood dinner");
  // A day whose first event is in the evening still says so.
  assert.equal(by["Sun Nov 15 2026"], "Evening / Family dinner");
  assert.equal(by["Thu Nov 19 2026"], "Team standup / Noon / Design review / Interview");
  // At 10:00 today's Noon is still ahead, so it isn't dimmed.
  assert.equal(await page.eval("document.querySelector('.day.today .pm-noon').classList.contains('past')"), false);
  assert.equal(await page.eval("document.querySelector('.day.today .pm-noon').getAttribute('aria-label')"), "Noon, from 12:00 PM");
});

const slotOf = (title, day = "Mon Nov 16 2026") => `[...document.querySelectorAll('[data-day="${day}"] .slot')].find((li) => li.querySelector('.c-title').textContent === ${JSON.stringify(title)})`;

test("each event sits beside a time column: start, AM/PM, end, in its hour's sky", async () => {
  const coffee = await page.eval(`(() => { const li = ${slotOf("Coffee with Alex")};
    return { time: li.querySelector('.ck-time').textContent, ap: li.querySelector('.ck-ap').textContent,
      end: li.querySelector('.ck-end').textContent, cls: li.className, sub: li.querySelector('.c-loc').textContent,
      when: !!li.querySelector('.c-when'), size: parseFloat(getComputedStyle(li.querySelector('.ck-time')).fontSize),
      clockRight: li.querySelector('.c-clock').getBoundingClientRect().right, cardLeft: li.querySelector('.card').getBoundingClientRect().left }; })()`);
  assert.deepEqual([coffee.time, coffee.ap, coffee.end], ["3:00", "PM", "4:00"]);
  assert.match(coffee.cls, /sky-afternoon/);
  assert.equal(coffee.sub, "1 h · Corner Café", "the card says how long, not when");
  assert.equal(coffee.when, false);
  assert.ok(coffee.size >= 16, `start time leads the column, got ${coffee.size}px`);
  assert.ok(coffee.cardLeft > coffee.clockRight, "the column sits beside the card");
  assert.match(await page.eval(`${slotOf("Team standup")}.className`), /sky-morning/);
  assert.match(await page.eval(`${slotOf("Gym")}.className`), /sky-evening/);
  // Every column in a day lines up, so the eye can run down it.
  const rights = await page.eval("[...document.querySelectorAll('.day.today .c-clock')].map((c) => Math.round(c.getBoundingClientRect().right))");
  assert.equal(new Set(rights).size, 1);
});

test("the duration bar grows with the event's length", async () => {
  const bar = (t) => page.eval(`${slotOf(t, "Tue Nov 17 2026")}.querySelector('.ck-bar').getBoundingClientRect().height`);
  const standup = await bar("Team standup"), planning = await bar("Quarterly planning");
  assert.ok(planning > standup * 2, `2 h bar (${planning}) is much longer than 15 min (${standup})`);
});

test("the sky strip is grey up to Now and on past days, colored after", async () => {
  const strip = await page.eval(`[...document.querySelectorAll('.day.today .cards > li[data-sky]')].map((li) =>
    [li.classList.contains('now-mark') ? 'NOW' : li.querySelector('.c-title, .pm-label').textContent, li.style.getPropertyValue('--st-a'), li.style.getPropertyValue('--st-b')])`);
  assert.deepEqual(strip, [
    ["Breakfast with Sam", "var(--strip-past)", "var(--strip-past)"],
    ["Team standup", "var(--strip-past)", "var(--strip-past)"],
    ["NOW", "var(--strip-past)", "var(--strip-afternoon)"],
    ["Noon", "var(--strip-afternoon)", "var(--strip-afternoon)"],
    ["Coffee with Alex", "var(--strip-afternoon)", "var(--strip-evening)"],
    ["Evening", "var(--strip-evening)", "var(--strip-evening)"],
    ["Gym", "var(--strip-evening)", "var(--strip-evening)"],
  ]);
  const yesterday = await page.eval(`[...document.querySelectorAll('[data-day="Sun Nov 15 2026"] .cards > li[data-sky]')].map((li) => li.style.getPropertyValue('--st-a'))`);
  assert.ok(yesterday.length && yesterday.every((v) => v === "var(--strip-past)"));
  // The sun sits on the strip at the Now line.
  const sun = await page.eval(`(() => { const s = document.querySelector('.day.today .nm-sun').getBoundingClientRect(), b = ${slotOf("Coffee with Alex")}.querySelector('.ck-bar').getBoundingClientRect();
    return Math.abs((s.left + s.right) / 2 - (b.left + b.right) / 2); })()`);
  assert.ok(sun < 1.5, `sun is centered on the bar line, off by ${sun}`);
});

test("the Now mark is a sun by day and a moon at night", async () => {
  const icon = (p) => p.eval("(() => { const s = document.querySelector('.day.today .nm-sun'); return { sun: !!s.querySelector('.nm-disc'), moon: !!s.querySelector('.nm-moon') }; })()");
  assert.deepEqual(await icon(page), { sun: true, moon: false }, "10:00 AM is a sun");
  const night = await launch({ now: "2026-11-16T22:00:00" });
  try {
    await night.goto("?mock#week");
    assert.deepEqual(await icon(night), { sun: false, moon: true }, "10:00 PM is a moon");
    assert.deepEqual(night.errors, []);
  } finally { await night.close(); }
});

test("today's header has the sun arc in Day view only, placed by the time of day", async () => {
  assert.equal(await page.eval("document.querySelectorAll('.dh-sun').length"), 0, "Week has no room for it");
  const day = await launch();
  try {
    await day.goto("?mock#day");
    assert.equal(await day.eval("!!document.querySelector('.day.today .day-h .dh-sun')"), true);
    // 10:00 is 4 h into the 6 AM to 9 PM arc.
    assert.equal(await day.eval("document.querySelector('.dh-sun').dataset.progress"), "0.267");
    assert.deepEqual(day.errors, []);
  } finally { await day.close(); }
});

test("past events are grey until hovered", async () => {
  // Only the contents fade, like the time column: the card itself keeps the paper and
  // background of an upcoming one, so a past card never turns into a grey slab.
  const shell = (t) => page.eval(`(() => { const s = getComputedStyle(${slotOf(t)}.querySelector('.card'));
    return [s.filter, s.opacity, s.backgroundColor].join(' / '); })()`);
  assert.equal(await shell("Team standup"), await shell("Coffee with Alex"));
  const past = await page.eval(`(() => { const li = ${slotOf("Team standup")};
    return { body: getComputedStyle(li.querySelector('.c-body')).filter, clock: getComputedStyle(li.querySelector('.c-clock')).filter }; })()`);
  assert.match(past.body, /grayscale\(1\)/);
  assert.match(past.clock, /grayscale\(1\)/);
  assert.equal(await page.eval(`getComputedStyle(${slotOf("Coffee with Alex")}.querySelector('.c-body')).filter`), "none");
  const id = await page.eval(`${slotOf("Team standup")}.querySelector('.card').dataset.id`);
  const sel = `.day.today .card[data-id="${id}"]`;
  const lit = `getComputedStyle(document.querySelector('${sel} > .c-body')).filter === 'none' && getComputedStyle(document.querySelector('${sel} > .c-body')).opacity === '1'`;
  await page.hover(sel);
  await page.waitFor(lit);
  // The standup lies on breakfast. Spread out, it fades like the card beside it and lights up the same way.
  await page.click(sel);
  await page.waitFor(`document.querySelector('${sel}').closest('li').classList.contains('dk-open')`);
  await page.hover('#title');
  await page.settle();
  const look = (t) => page.eval(`(() => { const s = getComputedStyle(${slotOf(t)}.querySelector('.card > .c-body')); return s.filter + ' / ' + s.opacity; })()`);
  assert.equal(await look('Team standup'), await look('Breakfast with Sam'));
  await page.hover(sel);
  await page.waitFor(lit);
  const clock = await page.eval(`(() => { const b = ${slotOf('Team standup')}.querySelector('.c-clock').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + 12 }; })()`);
  await page.clickAt(clock.x, clock.y);
  await page.waitFor(`!${slotOf('Team standup')}.classList.contains('dk-open')`);
});

const rectOf = (expr) => page.eval(`(() => { const b = (${expr}).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, x: b.x + b.width / 2 }; })()`);
const cardOf = (t) => `[...document.querySelectorAll('.card')].find((c) => c.querySelector('.c-title').textContent === ${JSON.stringify(t)})`;
async function openAndClose(x, y, title) {
  await page.clickAt(x, y);
  await page.waitFor(`document.querySelector('.pv-title')?.textContent === ${JSON.stringify(title)}`);
  await page.key("Escape");
  await page.waitFor("!document.body.classList.contains('panel-open')");
  await page.settle();
}

test("an event that starts during another lies on it, as far down as its start is into that event", async () => {
  const id = await page.eval(`${cardOf("Call with Jo")}.dataset.id`);
  await page.center(`.card[data-id="${id}"]`);
  const call = await rectOf(cardOf("Call with Jo"));
  const plan = await rectOf(cardOf("Quarterly planning"));
  // Planning runs 10:00-12:00 and the call starts at 11:30: three quarters in,
  // but never so low that less than 22 px of the two overlap.
  const h = plan.bottom - plan.top;
  const want = Math.min(Math.round(0.75 * h), h - 22);
  assert.ok(Math.abs(call.top - plan.top - want) <= 1, `${want} px down, got ${call.top - plan.top}`);
  assert.ok(Math.abs(call.left - plan.left) <= 1, "a later start lines up left, not shifted right");
  assert.match(await page.eval(`${cardOf("Call with Jo")}.getAttribute('aria-label')`), /overlaps Quarterly planning/);
});

test("a tap spreads a stack apart, spread cards open, and the time column stacks them again", async () => {
  const isOpen = () => page.eval("document.body.classList.contains('panel-open')");
  const spread = () => page.eval(`[...${cardOf("Call with Jo")}.closest('ol').querySelectorAll('li[data-run]')].map((li) => li.classList.contains('dk-open'))`);
  let call = await rectOf(cardOf("Call with Jo"));
  let plan = await rectOf(cardOf("Quarterly planning"));
  // Tapping either card of the stack spreads it instead of opening anything.
  await page.clickAt(call.x, plan.bottom - 8);
  await page.settle();
  assert.equal(await isOpen(), false);
  assert.deepEqual(await spread(), [true, true]);
  assert.equal(await page.eval(`${cardOf("Call with Jo")}.getAttribute('aria-expanded')`), "true");
  call = await rectOf(cardOf("Call with Jo"));
  plan = await rectOf(cardOf("Quarterly planning"));
  assert.ok(call.top >= plan.bottom + 6, "no longer overlapping");
  assert.ok(Math.abs(call.left - plan.left) < 1, "lined up again");
  // Spread, each card opens as usual.
  await openAndClose(call.x, (call.top + call.bottom) / 2, "Call with Jo");
  await openAndClose(plan.x, (plan.top + plan.bottom) / 2, "Quarterly planning");
  // The time column beside the run stacks it again.
  const clock = await rectOf(`${cardOf("Quarterly planning")}.closest('li').querySelector('.c-clock')`);
  await page.clickAt(clock.x, clock.top + 12);
  await page.settle();
  assert.deepEqual(await spread(), [false, false]);
  assert.equal(await isOpen(), false);
  call = await rectOf(cardOf("Call with Jo"));
  plan = await rectOf(cardOf("Quarterly planning"));
  assert.ok(call.top < plan.bottom - 15, "overlapping again");
});

test("events that start together start at the same height, the shorter one on top", async () => {
  const order = await page.eval(`[...document.querySelectorAll('[data-day="Thu Nov 19 2026"] li[data-run]')].map((li) => li.querySelector('.c-title').textContent + (li.classList.contains('dk-tuck') ? ' (tucked)' : ''))`);
  assert.deepEqual(order, ["Design review", "Interview (tucked)"]);
  const review = await rectOf(cardOf("Design review"));
  const interview = await rectOf(cardOf("Interview"));
  assert.ok(Math.abs(interview.top - review.top) <= 1, `same height, got ${interview.top} vs ${review.top}`);
  assert.ok(interview.left - review.left >= 47, "the card below still shows its tile");
  // One shared start time in the column; the one on top doesn't repeat it.
  const vis = await page.eval(`getComputedStyle(${cardOf("Interview")}.closest('li').querySelector('.ck-time')).visibility`);
  assert.equal(vis, "hidden");
  assert.equal(await page.eval(`${cardOf("Interview")}.querySelector('.c-at')`), null);
});

test("a start time with no room in the time column shows in the card instead", async () => {
  // The hike runs 8:00-14:00 and the market starts at 9:00: a sixth of the way down.
  const li = `${cardOf("Farmers market")}.closest('li')`;
  await page.waitFor(`${li}.classList.contains('dk-notime')`);
  assert.equal(await page.eval(`getComputedStyle(${li}.querySelector('.ck-time')).visibility`), "hidden");
  assert.equal(await page.eval(`getComputedStyle(${cardOf("Farmers market")}.querySelector('.c-at')).display`), "inline");
  assert.match(await page.eval(`${cardOf("Farmers market")}.querySelector('.c-at').textContent`), /^9:00\sAM · $/);
  // Flight 7:15-13:40, standup at 9:30: far enough down for the time to stay in the column.
  assert.equal(await page.eval(`document.querySelector('[data-day="Fri Nov 20 2026"] li.dk-tuck').classList.contains('dk-notime')`), false);
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
  // An empty today keeps its Now line, with the sun (10 AM).
  assert.deepEqual(await page.eval("[...document.querySelectorAll('.day.today .cards > li')].map((li) => li.className)"), ["now-mark st-first st-last", "day-empty"]);
  assert.ok(await page.eval("!!document.querySelector('.day.today .now-mark .nm-sun:not(.night) .nm-disc')"));
});
