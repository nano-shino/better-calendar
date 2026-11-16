import { test } from "node:test";
import assert from "node:assert/strict";

const { overlapUnits } = await import("../../js/overlaps.js");

const day = new Date(2026, 10, 19);
const at = (h, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
const ev = (id, sh, sm, eh, em) => ({ id, start: at(sh, sm), end: at(eh, em), allDay: false });
const sorted = (evs) => [...evs].sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start) || (b.end - a.end));
// "id:run" plus ^ for tucked and _ for under, e.g. "b:0^"
const shape = (units) => units.map((u) => `${u.ev.id}:${u.run}${u.tucked ? "^" : ""}${u.under ? "_" : ""}`);

test("events that don't overlap each start their own run, back-to-back included", () => {
  const units = overlapUnits(sorted([ev("a", 10, 0, 12, 0), ev("b", 12, 0, 13, 0), ev("c", 14, 0, 14, 30)]), day);
  assert.deepEqual(shape(units), ["a:0", "b:1", "c:2"]);
});

test("an event that starts later tucks over the card it overlaps", () => {
  const units = overlapUnits(sorted([ev("review", 15, 0, 16, 0), ev("package", 15, 30, 16, 15)]), day);
  assert.deepEqual(shape(units), ["review:0_", "package:0^"]);
});

test("events that start together tuck too, the longer one underneath", () => {
  const units = overlapUnits(sorted([ev("interview", 15, 0, 15, 45), ev("review", 15, 0, 16, 0)]), day);
  assert.deepEqual(shape(units), ["review:0_", "interview:0^"]);
});

test("a run lasts until its longest event ends", () => {
  const units = overlapUnits(sorted([ev("hike", 8, 0, 14, 0), ev("picnic", 11, 30, 12, 30), ev("call", 13, 0, 13, 15), ev("dinner", 18, 0, 19, 0)]), day);
  assert.deepEqual(shape(units), ["hike:0_", "picnic:0^_", "call:0^", "dinner:1"]);
});

test("a tucked card knows how far into the card below it starts, and how deep it sits", () => {
  const units = overlapUnits(sorted([ev("review", 15, 0, 16, 0), ev("interview", 15, 0, 15, 45), ev("call", 15, 20, 15, 40), ev("text", 15, 25, 15, 30)]), day);
  const facts = units.map((u) => [u.ev.id, +u.at.toFixed(3), u.depth, u.sameStart]);
  assert.deepEqual(facts, [
    ["review", 0, 0, false],
    ["interview", 0, 1, true], // same start: same height, shifted right
    ["call", 0.444, 0, false], // 20 of the interview's 45 minutes in, lined up left
    ["text", 0.25, 0, false],
  ]);
  const same = overlapUnits(sorted([ev("a", 9, 0, 12, 0), ev("b", 9, 0, 11, 0), ev("c", 9, 0, 10, 0), ev("d", 9, 0, 9, 30)]), day);
  assert.deepEqual(same.map((u) => u.depth), [0, 1, 2, 2], "no deeper than two");
  const half = overlapUnits(sorted([ev("hike", 8, 0, 14, 0), ev("picnic", 11, 0, 12, 0)]), day);
  assert.equal(half[1].at, 0.5);
});

test("all-day events never join a run, and events from yesterday count from midnight", () => {
  const trip = { id: "trip", start: new Date(2026, 10, 18), end: new Date(2026, 10, 21), allDay: true };
  const party = { id: "party", start: new Date(2026, 10, 18, 22), end: at(1, 0), allDay: false };
  const units = overlapUnits(sorted([trip, party, ev("flight", 0, 30, 2, 0)]), day);
  assert.deepEqual(shape(units), ["trip:0", "party:1_", "flight:1^"]);
});
