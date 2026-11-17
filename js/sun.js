// Sunrise and sunset, so the Now mark turns to a moon when it's actually dark and
// today's sun arc runs from sunrise to sunset. Only with "Sunrise and sunset where you
// are" (Advanced), which asks the browser for the device's location once, from a click,
// and keeps it on this device only, rounded to about 10 km. Without it, a fixed day
// from 6 AM to 9 PM stands in.
import { loadJSON, saveJSON } from "./util.js";

const KEY = "bd:place";
const DAY = 86400000;
const rad = Math.PI / 180;

// The saved place, { lat, lon } in degrees, or null.
export function place() {
  const p = loadJSON(KEY, null);
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
}

const round = (x) => Math.round(x * 10) / 10;
export const savePlace = (lat, lon) => saveJSON(KEY, { lat: round(lat), lon: round(lon) });
export const forgetPlace = () => saveJSON(KEY, null);

// Asks the browser where the device is. Call it from a click (it may show a prompt).
// Coarse is plenty: the sun rises a minute later every ~20 km.
export function locate({ maximumAge = 6 * 3600000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("This browser can't tell where you are.")); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { savePlace(pos.coords.latitude, pos.coords.longitude); resolve(place()); },
      (err) => reject(new Error(err.code === 1 ? "Location is blocked for this site." : "Couldn't find where you are.")),
      { enableHighAccuracy: false, maximumAge, timeout: 15000 });
  });
}

// Once a saved place exists and the browser already allows location, refresh it quietly
// (people travel). Never prompts: a prompt has to come from a click.
export async function refreshPlace() {
  if (!place() || !navigator.permissions) return false;
  try {
    const st = await navigator.permissions.query({ name: "geolocation" });
    if (st.state !== "granted") return false;
    const before = JSON.stringify(place());
    await locate();
    return JSON.stringify(place()) !== before;
  } catch { return false; }
}

// Sunrise and sunset on the day around `date` at lat/lon (degrees, east positive), from
// the standard sunrise equation (within a minute or two away from the poles).
// Returns { rise, set } as Dates, or { polar: "day" | "night" } when the sun doesn't cross the horizon.
export function sunTimes(date, lat, lon) {
  const toJ = (ms) => ms / DAY + 2440587.5, fromJ = (j) => new Date((j - 2440587.5) * DAY);
  // The solar noon nearest to midday on that date, here.
  const noon = new Date(date); noon.setHours(12, 0, 0, 0);
  const n = Math.round(toJ(+noon) - 2451545.0009 + lon / 360);
  const jStar = 2451545.0009 + n - lon / 360;
  const M = (357.5291 + 0.98560028 * (jStar - 2451545)) % 360;
  const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
  const L = (M + C + 180 + 102.9372) % 360;
  const transit = jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * L * rad);
  const sinD = Math.sin(L * rad) * Math.sin(23.4397 * rad), cosD = Math.cos(Math.asin(sinD));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * sinD) / (Math.cos(lat * rad) * cosD);
  if (cosW < -1) return { polar: "day" };
  if (cosW > 1) return { polar: "night" };
  const w = Math.acos(cosW) / rad / 360;
  return { rise: fromJ(transit - w), set: fromJ(transit + w) };
}

// Today's day for the sun arc and the Now mark: { start, end } as Dates, and whether
// it comes from the real sun. Falls back to 6 AM to 9 PM without a place, or where the
// sun doesn't rise or set today.
export function daylight(now, p = place()) {
  const t = p ? sunTimes(now, p.lat, p.lon) : null;
  if (t?.rise) return { start: t.rise, end: t.set, real: true };
  const at = (hr) => { const d = new Date(now); d.setHours(hr, 0, 0, 0); return d; };
  if (t?.polar === "day") return { start: at(0), end: new Date(+at(0) + DAY), real: true };
  if (t?.polar === "night") return { start: at(12), end: at(12), real: true };
  return { start: at(6), end: at(21), real: false };
}

export const isNight = (now, p = place()) => { const d = daylight(now, p); return now < d.start || now >= d.end; };
