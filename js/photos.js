// Picks a photo for each event.
// Order: your choice for the event > for the repeating series > keyword match >
// image link in the description > a hand-checked photo when the title clearly
// names a kind of event (gym, flight, dinner...). Anything else gets no photo.

import { getProfile, getPhoto, putPhoto, deletePhoto, update } from "./store.js";
import { hash, loadJSON, saveJSON } from "./util.js";
import { CURATED } from "./curated.js";

const STOP = new Set(("a an the and or with w for of to at in on by my our your from re fw fwd call meet meeting sync weekly daily monthly " +
  "quick catch up catchup chat session review discussion am pm tbd invite invitation updated event hold busy block ooo").split(" "));

// Specific kinds first: "Yoga class" is yoga, not study.
const THEMES = [
  { key: "dentist", label: "dentist", q: "dentist", re: /\b(dentist|dental|orthodontist|teeth cleaning)\b/i },
  { key: "doctor", label: "doctor", q: "doctor stethoscope", re: /\b(doctor|clinic|check-?up|physio|physiotherapy|hospital|medical appointment)\b/i },
  { key: "birthday", label: "birthday", q: "birthday cake", re: /\b(birthday|bday|b-day)\b/i },
  { key: "wedding", label: "wedding", q: "wedding", re: /\b(wedding)\b/i },
  { key: "flight", label: "flight", q: "airplane wing", re: /\b(flight|flying|fly to|airport|boarding)\b/i },
  { key: "train", label: "train", q: "train station", re: /\b(train (to|from|ride))\b/i },
  { key: "yoga", label: "yoga", q: "yoga", re: /\b(yoga|pilates|meditation|meditate)\b/i },
  { key: "swim", label: "swimming", q: "swimming pool", re: /\b(swim|swimming)\b/i },
  { key: "run", label: "running", q: "running", re: /\b(running|jog|jogging|marathon|parkrun|5k|10k|(morning|evening|long|easy|trail|go for a) run)\b/i },
  { key: "gym", label: "gym", q: "gym", re: /\b(gym|workout|weights|lifting|crossfit|fitness)\b/i },
  { key: "cycling", label: "cycling", q: "cycling", re: /\b(cycling|bike ride|biking|spin class)\b/i },
  { key: "hike", label: "hiking", q: "mountain hike", re: /\b(hike|hiking|trek|trekking)\b/i },
  { key: "beach", label: "beach", q: "beach", re: /\b(beach|surf|surfing|snorkel\w*)\b/i },
  { key: "tennis", label: "tennis", q: "tennis court", re: /\b(tennis|pickleball|padel)\b/i },
  { key: "basketball", label: "basketball", q: "basketball", re: /\b(basketball)\b/i },
  { key: "soccer", label: "football", q: "soccer ball", re: /\b(soccer|football|futsal)\b/i },
  { key: "concert", label: "concert", q: "concert", re: /\b(concert|gig|live music|festival)\b/i },
  { key: "movie", label: "movie", q: "cinema", re: /\b(movie|movies|cinema)\b/i },
  { key: "games", label: "games", q: "board game", re: /\b(board games?|game night|d&d|dnd)\b/i },
  { key: "cooking", label: "cooking", q: "cooking", re: /\b(cooking|baking|meal prep)\b/i },
  { key: "coffee", label: "coffee", q: "coffee", re: /\b(coffee|cafe|café|latte|espresso)\b/i },
  { key: "lunch", label: "lunch", q: "lunch", re: /\b(lunch|brunch)\b/i },
  { key: "dinner", label: "dinner", q: "dinner", re: /\b(dinner|supper|date night|bbq|barbecue|restaurant)\b/i },
  { key: "market", label: "market", q: "farmers market", re: /\b(farmers market|grocery|groceries)\b/i },
  { key: "haircut", label: "haircut", q: "barber", re: /\b(haircut|hair cut|barber|hair salon)\b/i },
  { key: "dog", label: "dog", q: "dog", re: /\b(dog walk|walk the dog|vet appointment|veterinar\w*|puppy)\b/i },
  { key: "travel", label: "trip", q: "travel", re: /\b(trip|vacation|travel|getaway)\b/i },
  { key: "study", label: "study", q: "library books", re: /\b(study session|study group|lecture|exam|homework|library|tutoring)\b/i },
  { key: "meeting", label: "meeting", q: "meeting room", re: /\b(stand-?up|scrum|sprint planning|retro|retrospective|all[- ]hands|workshop|interview|offsite|meeting|1:1|one[- ]on[- ]one)\b/i },
];

// The kind of event a title clearly names, or null.
// An untitled event's title is our own placeholder ("Busy", "No title"), so it names nothing.
export function themeFor(ev) {
  if (ev.untitled) return null;
  const title = String(ev.title || "");
  return THEMES.find((t) => t.re.test(title)) || null;
}

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

// Starting text for the photo search box in the event panel.
export function autoQuery(ev) {
  const theme = themeFor(ev);
  if (theme) return theme.q;
  const w = ev.untitled ? [] : wordsOf(ev.title).slice(0, 3);
  if (w.length) return w.join(" ");
  return placeName(ev.location);
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
  if (ev.untitled) return null;
  const t = ev.title.toLowerCase();
  const kw = rules.keywords.find((k) => k.word && t.includes(k.word.toLowerCase()));
  if (kw) return { pick: kw.pick, scope: "keyword", word: kw.word };
  return null;
}

// Resolved photos are memoized per event so re-renders paint instantly.
const memo = new Map();
const memoKey = (ev) => `${ev.id}|${ev.title}`;
export const resetMemo = () => memo.clear();

// Whether this event will get a photo, known without waiting for any download.
export function expectsPhoto(ev) {
  if (ruleFor(ev)) return true;
  if (imageFromDescription(ev.description)) return true;
  if (getProfile().autoPhotos === false) return false;
  const theme = themeFor(ev);
  return !!(theme && CURATED[theme.key]?.length);
}

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
  if (getProfile().autoPhotos === false) return null;
  const theme = themeFor(ev);
  const set = theme && CURATED[theme.key];
  if (!set?.length) return null;
  return set[hash(ev.seriesId || ev.title) % set.length];
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
