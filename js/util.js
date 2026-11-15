// Small DOM + date helpers shared by every module.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "vars") for (const [n, val] of Object.entries(v)) el.style.setProperty(n, val);
    else if (k === "style") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

export const DAY = 86400000;
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => { const x = new Date(d); x.setDate(1); x.setMonth(x.getMonth() + n); return x; };
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const parseLocalDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
export const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

// First day of week from the browser's locale (0 = Sunday, 1 = Monday).
export const WEEK_START = (() => {
  try {
    const loc = new Intl.Locale(navigator.language);
    const info = loc.getWeekInfo ? loc.getWeekInfo() : loc.weekInfo;
    if (info && info.firstDay) return info.firstDay % 7;
  } catch { /* older browsers */ }
  return 1;
})();
export const startOfWeek = (d) => { const x = startOfDay(d); const diff = (x.getDay() - WEEK_START + 7) % 7; return addDays(x, -diff); };

const lang = navigator.language;
export const fmt = {
  time: new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" }),
  hour: new Intl.DateTimeFormat(lang, { hour: "numeric" }),
  month: new Intl.DateTimeFormat(lang, { month: "long" }),
  monthShort: new Intl.DateTimeFormat(lang, { month: "short" }),
  dow: new Intl.DateTimeFormat(lang, { weekday: "short" }),
  dowLong: new Intl.DateTimeFormat(lang, { weekday: "long" }),
  long: new Intl.DateTimeFormat(lang, { weekday: "long", month: "long", day: "numeric" }),
  short: new Intl.DateTimeFormat(lang, { month: "short", day: "numeric" }),
};

// "9:30" instead of "9:30 AM" when two times share the same half of the day.
export function timeRange(a, b) {
  const pa = fmt.time.formatToParts(a), pb = fmt.time.formatToParts(b);
  const ap = (p) => (p.find((x) => x.type === "dayPeriod") || {}).value;
  if (ap(pa) && ap(pa) === ap(pb)) {
    const bare = pa.filter((x) => x.type !== "dayPeriod").map((x) => x.value).join("").trim();
    return `${bare} – ${fmt.time.format(b)}`;
  }
  return `${fmt.time.format(a)} – ${fmt.time.format(b)}`;
}
export function shortTime(d) {
  // Compact label for dense places (month cells): "9:30a", "6p", or "18:00".
  const twelve = fmt.time.formatToParts(d).some((p) => p.type === "dayPeriod");
  const hr = d.getHours(), mm = String(d.getMinutes()).padStart(2, "0");
  if (!twelve) return `${hr}:${mm}`;
  return `${hr % 12 || 12}${mm === "00" ? "" : ":" + mm}${hr < 12 ? "a" : "p"}`;
}
export function duration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m} min`;
  const hr = Math.floor(m / 60), r = m % 60;
  return r ? `${hr} h ${r} min` : `${hr} h`;
}
export function relative(ms) {
  const m = Math.round(ms / 60000);
  if (m <= 0) return "now";
  if (m < 60) return `in ${m} min`;
  const hr = Math.round(m / 60);
  if (hr < 24) return `in ${hr} h`;
  const d = Math.round(hr / 24);
  return `in ${d} day${d > 1 ? "s" : ""}`;
}

export function hash(s) {
  let x = 2166136261;
  for (const c of String(s)) { x ^= c.codePointAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

export function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
export function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ }
}

// Run DOM updates inside a view transition when the browser supports it.
export function transition(update, kind) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce) {
    update();
    return { done: Promise.resolve(), finished: Promise.resolve() };
  }
  const root = document.documentElement;
  if (kind) root.dataset.vt = kind;
  const t = document.startViewTransition(update);
  t.finished.catch(() => {}).finally(() => { if (root.dataset.vt === kind) delete root.dataset.vt; });
  return { done: t.updateCallbackDone.catch(() => {}), finished: t.finished.catch(() => {}) };
}

// Google event descriptions are HTML. Keep text and line breaks only.
export function descriptionText(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n"), "text/html");
  return (doc.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

// Turn plain text into nodes with clickable https links.
export function linkify(text) {
  const out = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h("a", { href: m[0], target: "_blank", rel: "noopener", text: m[0].replace(/^https?:\/\//, "").slice(0, 60) }));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
