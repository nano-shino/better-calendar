process.env.TZ = "UTC";
import { test } from "node:test";
import assert from "node:assert/strict";
const { sunTimes, daylight, isNight } = await import("../../js/sun.js");

const near = (d, iso, min = 5) => assert.ok(Math.abs(d - new Date(iso)) < min * 60000, `${d.toISOString()} is within ${min} min of ${iso}`);

test("sunrise and sunset on the equator at an equinox are about 12 h apart", () => {
  const t = sunTimes(new Date("2026-03-20T12:00:00Z"), 0, 0);
  near(t.rise, "2026-03-20T06:04:00Z");
  near(t.set, "2026-03-20T18:11:00Z");
});

test("a midsummer day at 45° N is long, and longitude shifts it", () => {
  const t = sunTimes(new Date("2026-06-21T12:00:00Z"), 45, 0);
  near(t.rise, "2026-06-21T04:13:00Z");
  near(t.set, "2026-06-21T19:52:00Z");
  const east = sunTimes(new Date("2026-06-21T12:00:00Z"), 45, 15);
  near(east.rise, "2026-06-21T03:13:00Z");
});

test("near the poles the sun can stay up or down all day", () => {
  assert.deepEqual(sunTimes(new Date("2026-06-21T12:00:00Z"), 75, 0), { polar: "day" });
  assert.deepEqual(sunTimes(new Date("2026-12-21T12:00:00Z"), 75, 0), { polar: "night" });
});

test("night follows the sun with a place, and is 9 PM to 6 AM without one", () => {
  const evening = new Date("2026-11-16T20:44:00Z");
  assert.equal(isNight(evening, null), false);
  assert.equal(isNight(new Date("2026-11-16T22:00:00Z"), null), true);
  assert.equal(isNight(new Date("2026-11-16T05:59:00Z"), null), true);
  assert.equal(daylight(evening, null).real, false);
  assert.equal(isNight(evening, { lat: 45, lon: 0 }), true, "in November the sun set hours ago");
  assert.equal(isNight(new Date("2026-11-16T12:00:00Z"), { lat: 45, lon: 0 }), false);
  assert.equal(isNight(new Date("2026-12-21T12:00:00Z"), { lat: 75, lon: 0 }), true, "polar night");
});
