import { test } from "node:test";
import assert from "node:assert/strict";

const { overlapUnits } = await import("../../js/overlaps.js");

const day = new Date(2026, 10, 19);
const at = (h, m = 0) => { const d = new Date(day); d.setHours(h, m, 0, 0); return d; };
const ev = (id, sh, sm, eh, em) => ({ id, start: at(sh, sm), end: at(eh, em), allDay: false });
const sorted = (evs) => [...evs].sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start) || (b.end - a.end));
const shape = (units) => units.map((u) => ({ ids: u.evs.map((e) => e.id), head: u.head, tucked: u.tucked, under: u.under }));

test("events that don't overlap stay one card each, back-to-back included", () => {
  const units = overlapUnits(sorted([ev("a", 10, 0, 12, 0), ev("b", 12, 0, 13, 0), ev("c", 14, 0, 14, 30)]), day);
  assert.deepEqual(shape(units), [
    { ids: ["a"], head: true, tucked: false, under: false },
    { ids: ["b"], head: true, tucked: false, under: false },
    { ids: ["c"], head: true, tucked: false, under: false },
  ]);
});

test("events starting within 15 minutes of each other form a deck, longest in front", () => {
  const units = overlapUnits(sorted([ev("review", 15, 0, 16, 0), ev("interview", 15, 0, 15, 45), ev("late", 15, 10, 17, 0)]), day);
  assert.deepEqual(shape(units), [{ ids: ["late", "review", "interview"], head: true, tucked: false, under: false }]);
});

test("an event that starts later tucks over the card it overlaps", () => {
  const units = overlapUnits(sorted([ev("review", 15, 0, 16, 0), ev("package", 15, 30, 16, 15)]), day);
  assert.deepEqual(shape(units), [
    { ids: ["review"], head: true, tucked: false, under: true },
    { ids: ["package"], head: false, tucked: true, under: false },
  ]);
});

test("an event inside a longer one tucks too, and the run continues until the long one ends", () => {
  const units = overlapUnits(sorted([ev("hike", 8, 0, 14, 0), ev("picnic", 11, 30, 12, 30), ev("call", 13, 0, 13, 15), ev("dinner", 18, 0, 19, 0)]), day);
  assert.deepEqual(shape(units), [
    { ids: ["hike"], head: true, tucked: false, under: true },
    { ids: ["picnic"], head: false, tucked: true, under: true },
    { ids: ["call"], head: false, tucked: true, under: false },
    { ids: ["dinner"], head: true, tucked: false, under: false },
  ]);
});

test("a deck can be tucked over an earlier card", () => {
  const units = overlapUnits(sorted([ev("a", 9, 0, 11, 0), ev("b", 10, 0, 10, 30), ev("c", 10, 5, 10, 45)]), day);
  assert.deepEqual(shape(units), [
    { ids: ["a"], head: true, tucked: false, under: true },
    { ids: ["c", "b"], head: false, tucked: true, under: false },
  ]);
});

test("all-day events never join a run, and events from yesterday count from midnight", () => {
  const trip = { id: "trip", start: new Date(2026, 10, 18), end: new Date(2026, 10, 21), allDay: true };
  const party = { id: "party", start: new Date(2026, 10, 18, 22), end: at(1, 0), allDay: false };
  const units = overlapUnits(sorted([trip, party, ev("flight", 0, 10, 2, 0)]), day);
  assert.deepEqual(shape(units), [
    { ids: ["trip"], head: true, tucked: false, under: false },
    { ids: ["flight", "party"], head: true, tucked: false, under: false },
  ]);
});
