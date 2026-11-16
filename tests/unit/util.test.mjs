import { test } from "node:test";
import assert from "node:assert/strict";

const util = await import("../../js/util.js");
const { sampleEvents } = await import("../../js/sample.js");

test("tile letter: the first letter or digit, never punctuation", () => {
  assert.equal(util.tileLetter("Gym"), "G");
  assert.equal(util.tileLetter("(Draft) plan"), "D");
  assert.equal(util.tileLetter("  [ext] market"), "E");
  assert.equal(util.tileLetter("élan"), "É");
  assert.equal(util.tileLetter("1:1 with Sam"), "1");
  assert.equal(util.tileLetter("🎉 !!"), "•");
  assert.equal(util.tileLetter(""), "•");
});

test("dates: adding days and months, same-day checks", () => {
  const d = new Date(2026, 0, 31);
  assert.equal(util.addMonths(d, 1).getMonth(), 1, "Jan 31 + 1 month lands in February");
  assert.equal(util.addDays(d, 1).getDate(), 1);
  assert.ok(util.sameDay(new Date(2026, 4, 1, 1), new Date(2026, 4, 1, 23)));
  assert.equal(util.parseLocalDate("2026-11-16").getDate(), 16);
});

test("durations and relative times read naturally", () => {
  assert.equal(util.duration(15 * 60000), "15 min");
  assert.equal(util.duration(60 * 60000), "1 h");
  assert.equal(util.duration(95 * 60000), "1 h 35 min");
  assert.equal(util.relative(30 * 60000), "in 30 min");
});

test("sample events cover a whole week, with repeats sharing a series id", () => {
  const start = new Date(2026, 10, 15);
  const events = sampleEvents(start, util.addDays(start, 7));
  const standups = events.filter((e) => e.title === "Team standup");
  assert.equal(standups.length, 5);
  assert.ok(standups.every((e) => e.seriesId === "s-standup"));
  assert.ok(events.every((e) => e.end >= e.start));
});

test("fetch blocks: whole months widened to whole weeks, covering every view inside them", () => {
  const d = (m, day) => new Date(2026, m - 1, day);
  const days = (b) => [b.start.toDateString(), b.end.toDateString()];
  const week = util.startOfWeek;
  // Day, week and month in November share one block.
  const nov = util.blockOf(d(11, 1), d(12, 1));
  assert.deepEqual(util.blockOf(d(11, 16), d(11, 17)), nov);
  assert.deepEqual(util.blockOf(week(d(11, 16)), util.addDays(week(d(11, 16)), 7)), nov);
  assert.equal(+nov.start, +week(d(11, 1)));
  // The last week of the month, which runs into December, is inside it too.
  const lastWeek = week(d(11, 30));
  assert.ok(nov.start <= lastWeek && nov.end >= util.addDays(lastWeek, 7), days(nov).join(" – "));
  // A range across a month edge gets both months.
  const both = util.blockOf(d(11, 29), d(12, 6));
  assert.ok(both.start <= d(11, 1) && both.end >= new Date(2027, 0, 1));
});
