// Picks a photo for each event.
// Order: your choice for the event > for the repeating series > keyword match >
// image link in the description > automatic Openverse photo from title/location.

import { getProfile, getPhoto, putPhoto, deletePhoto, update } from "./store.js";
import { hash, loadJSON, saveJSON } from "./util.js";

const STOP = new Set(("a an the and or with w for of to at in on by my our your from re fw fwd call meet meeting sync weekly daily monthly " +
  "quick catch up catchup chat session review discussion am pm tbd invite invitation updated event hold busy block ooo").split(" "));

const THEMES = [
  [/stand ?up|scrum|sprint|retro|1:1|1-1|one on one|all[- ]hands|planning|interview|office|design review|workshop/i, "minimal office desk"],
  [/gym|workout|lift|crossfit|fitness|training/i, "gym workout"],
  [/\brun\b|running|jog|marathon|\b5k\b|\b10k\b/i, "running trail morning"],
  [/yoga|pilates|meditat|stretch/i, "yoga calm"],
  [/swim/i, "swimming pool water"],
  [/flight|fly|airport|plane/i, "airplane window clouds"],
  [/train\b|rail/i, "train journey landscape"],
  [/hike|hiking|trail|mt\.|mount/i, "mountain trail"],
  [/beach|surf/i, "beach ocean"],
  [/coffee|cafe|café|latte/i, "coffee cup cafe"],
  [/lunch|brunch/i, "lunch table food"],
  [/dinner|pizza|bbq|restaurant|supper/i, "dinner table food"],
  [/birthday|party|celebrat|anniversary/i, "celebration lights"],
  [/dentist|doctor|clinic|checkup|appointment|therapy/i, "calm clinic interior"],
  [/concert|gig|music|band|festival/i, "concert lights"],
  [/movie|cinema|film/i, "cinema seats"],
  [/study|class|lecture|exam|school|course/i, "library books"],
  [/market|grocer|shopping/i, "farmers market"],
  [/game|gaming/i, "board games"],
  [/football|soccer|basketball|tennis|badminton|golf/i, "sports field"],
  [/trip|vacation|holiday|travel/i, "travel landscape"],
  [/family|kids|mom|dad|parents/i, "family home warm"],
];

export function wordsOf(text) {
  return String(text || "").toLowerCase().replace(/[^\p{L}\p{N}\s'.-]/gu, " ").split(/\s+/)
    .map((w) => w.replace(/^[.'-]+|[.'-]+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w));
}

function placeName(location) {
  const first = String(location || "").split(",")[0];
  if (!first || /\d/.test(first) || /https?:|zoom|meet\.google|teams/i.test(first)) return "";
  const w = wordsOf(first);
  return w.length && w.length <= 3 ? w.join(" ") : "";
}

export function autoQuery(ev) {
  const place = placeName(ev.location);
  for (const [re, q] of THEMES) {
    if (!re.test(ev.title)) continue;
    // A city or landmark makes a more personal scene for trips and meals.
    if (place && /trip|travel|vacation|holiday|hike|dinner|lunch|flight/i.test(ev.title)) return place;
    return q;
  }
  const w = wordsOf(ev.title).slice(0, 3);
  if (w.length) return w.join(" ");
  return place;
}

function imageFromDescription(desc) {
  if (!desc) return null;
  const img = desc.match(/<img[^>]+src=["'](https:\/\/[^"']+)["']/i);
  if (img) return img[1];
  const direct = desc.match(/https:\/\/[^\s"'<>]+\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>]*)?/i);
  return direct ? direct[0] : null;
}

// ---- Openverse search, cached for a week, at most 4 requests at once ----
const TTL = 7 * 86400000;
const inflight = new Map();
let active = 0;
const queue = [];
function throttle(fn) {
  return new Promise((res, rej) => {
    const run = () => { active++; fn().then(res, rej).finally(() => { active--; queue.length && queue.shift()(); }); };
    active < 4 ? run() : queue.push(run);
  });
}

export function search(query, size = 12) {
  const q = query.trim().toLowerCase();
  if (!q) return Promise.resolve([]);
  const key = `bd:ov2:${size}:${q}`;
  const cached = loadJSON(key, null);
  if (cached && Date.now() - cached.t < TTL) return Promise.resolve(cached.r);
  if (inflight.has(key)) return inflight.get(key);
  const p = throttle(async () => {
    const url = new URL("https://api.openverse.org/v1/images/");
    url.search = new URLSearchParams({ q, page_size: String(size), aspect_ratio: "wide", mature: "false", category: "photograph" });
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status === 429 ? "Photo search is busy. Try again in a minute." : `Photo search returned ${r.status}`);
    const data = await r.json();
    const out = (data.results || []).map((x) => ({
      url: x.url,
      thumb: x.thumbnail || x.url,
      credit: {
        by: x.creator || "Unknown",
        license: `CC ${(x.license || "").toUpperCase()} ${x.license_version || ""}`.replace("CC CC0", "CC0").replace("CC PDM", "Public domain").trim(),
        link: x.foreign_landing_url || x.url,
      },
    }));
    saveJSON(key, { t: Date.now(), r: out });
    return out;
  }).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---- rules ----
export function ruleFor(ev) {
  const { rules } = getProfile();
  if (rules.event[ev.id]) return { pick: rules.event[ev.id], scope: "event" };
  if (ev.seriesId && rules.series[ev.seriesId]) return { pick: rules.series[ev.seriesId], scope: "series" };
  const t = ev.title.toLowerCase();
  const kw = rules.keywords.find((k) => k.word && t.includes(k.word.toLowerCase()));
  if (kw) return { pick: kw.pick, scope: "keyword", word: kw.word };
  return null;
}

// Resolved photos are memoized per event so re-renders paint instantly.
const memo = new Map();
const memoKey = (ev) => `${ev.id}|${ev.title}`;
export const resetMemo = () => memo.clear();

export function cachedPhoto(ev) {
  const v = memo.get(memoKey(ev));
  return v && !(v instanceof Promise) ? v : undefined;
}

export function photoFor(ev) {
  const k = memoKey(ev);
  if (memo.has(k)) return Promise.resolve(memo.get(k));
  const p = resolve(ev).then((v) => { memo.set(k, v); return v; }, () => { memo.delete(k); return null; });
  memo.set(k, p);
  return p;
}

async function fromPick(pick) {
  if (!pick) return null;
  if (pick.type === "upload") {
    const data = await getPhoto(pick.id);
    return data ? { url: data, thumb: data, mine: true } : null;
  }
  return { url: pick.url, thumb: pick.thumb || pick.url, credit: pick.credit };
}

async function resolve(ev) {
  const rule = ruleFor(ev);
  if (rule) {
    const p = await fromPick(rule.pick);
    if (p) return p;
  }
  const fromDesc = imageFromDescription(ev.description);
  if (fromDesc) return { url: fromDesc, thumb: fromDesc, credit: { by: "From the event description", link: fromDesc } };
  const q = autoQuery(ev);
  if (!q) return null;
  let results = await search(q);
  if (!results.length) {
    const place = placeName(ev.location);
    if (place && place !== q) results = await search(place);
  }
  if (!results.length) return null;
  return results[hash(ev.seriesId || ev.title) % results.length];
}

// ---- saving a choice ----
function usedUploads(rules) {
  const all = [...Object.values(rules.event), ...Object.values(rules.series), ...rules.keywords.map((k) => k.pick)];
  return new Set(all.filter((p) => p?.type === "upload").map((p) => p.id));
}

// Applies a change to the photo rules, then deletes uploads nothing uses anymore.
async function editRules(fn) {
  let before = new Set();
  try {
    await update((p) => { before = usedUploads(p.rules); fn(p.rules); });
  } finally {
    const after = usedUploads(getProfile().rules);
    before.forEach((id) => { if (!after.has(id)) deletePhoto(id); });
    resetMemo();
  }
}

export function choose(ev, scope, pick, word) {
  return editRules((rules) => {
    // Remove narrower choices so the new one is what shows.
    delete rules.event[ev.id];
    if (ev.seriesId && scope !== "event") delete rules.series[ev.seriesId];
    if (scope === "event") rules.event[ev.id] = pick;
    else if (scope === "series" && ev.seriesId) rules.series[ev.seriesId] = pick;
    else if (scope === "keyword") {
      const w = word.trim();
      const existing = rules.keywords.find((k) => k.word.toLowerCase() === w.toLowerCase());
      if (existing) existing.pick = pick; else rules.keywords.push({ word: w, pick });
    }
  });
}

export function clearChoice(ev) {
  const rule = ruleFor(ev);
  if (!rule) return Promise.resolve();
  return editRules((rules) => {
    if (rule.scope === "event") delete rules.event[ev.id];
    else if (rule.scope === "series") delete rules.series[ev.seriesId];
    else rules.keywords = rules.keywords.filter((k) => k.word !== rule.word);
  });
}

export function removeKeyword(word) {
  return editRules((rules) => { rules.keywords = rules.keywords.filter((k) => k.word !== word); });
}

// Shrinks an image to fit Firestore's 1 MiB document limit with room to spare.
export async function compress(file) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That file isn't an image this browser can read.");
  let max = 1800;
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale), hgt = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = hgt;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, hgt);
    const quality = attempt < 3 ? 0.84 - attempt * 0.08 : 0.7;
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length < 750000) return url;
    if (attempt >= 2) max = Math.round(max * 0.78);
  }
  throw new Error("That image is too large even after shrinking.");
}

export async function upload(file) {
  const data = await compress(file);
  const id = await putPhoto(data);
  return { type: "upload", id };
}
