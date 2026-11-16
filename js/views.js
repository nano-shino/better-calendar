// Day, Week and Month as lists: one event after another, grouped by day.
// Events with a photo get a large photo card; the rest get a compact plain card.
import { h, addDays, startOfDay, sameDay, fmt, timeRange, duration } from "./util.js";
import { photoFor, cachedPhoto, expectsPhoto } from "./photos.js";
import { overlapUnits } from "./overlaps.js";

const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, (c) => encodeURIComponent(c))}")`;

// Images already shown once. Re-renders paint them at once instead of fading
// them in again (the photo memo is cleared whenever a photo choice changes).
const painted = new Set();

// Fades a photo into el's .ph child once it has loaded. Instant if already known.
// A photo card's artwork (.c-art) also paints the blurred backdrop that immersive cards show.
export function paintPhoto(el, ev, size = "thumb") {
  const ph = el.querySelector(":scope > .ph");
  if (!ph) return;
  const glow = el.classList.contains("c-art") ? el.parentElement?.querySelector(":scope > .c-glow") : null;
  const src = (p) => (size === "full" ? p.url : p.thumb);
  const apply = (p) => {
    ph.style.backgroundImage = size === "full" && p.url !== p.thumb ? `${cssUrl(p.url)}, ${cssUrl(p.thumb)}` : cssUrl(src(p));
    if (glow) glow.style.backgroundImage = cssUrl(src(p));
  };
  const instant = (p) => { apply(p); ph.classList.add("shown", "instant"); el.classList.remove("no-photo"); };
  const known = cachedPhoto(ev);
  if (known !== undefined) {
    if (known) instant(known);
    else el.classList.add("no-photo");
    return;
  }
  photoFor(ev).then((p) => {
    if (!ph.isConnected) return;
    if (!p) { el.classList.add("no-photo"); return; }
    if (painted.has(src(p))) { instant(p); return; }
    const img = new Image();
    img.onload = () => { painted.add(src(p)); apply(p); requestAnimationFrame(() => ph.classList.add("shown")); };
    img.onerror = () => el.classList.add("no-photo");
    img.src = size === "full" ? p.url : p.thumb;
  });
}

// Events that touch a day, all-day first, then by start time.
export function eventsOn(day, events) {
  const next = addDays(day, 1);
  return events
    .filter((e) => e.start < next && (e.end > day || (+e.end === +e.start && e.start >= day)))
    .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start) || (b.end - a.end));
}

// Week, Month or Day as a list. `days` are the days in range; `mode` picks the density.
export function renderList(days, events, ctx, mode) {
  const today = startOfDay(new Date());
  const now = new Date();
  const root = h("section", { class: `agenda mode-${mode}` });
  const rangeStart = days[0];
  let shown = 0;

  // A repeating event gets one big photo card per range: its next occurrence
  // (or its first, if all are past). Other occurrences become compact rows.
  const lead = new Map();
  if (mode !== "day") {
    for (const e of [...events].sort((a, b) => a.start - b.start)) {
      if (!e.seriesId) continue;
      const cur = lead.get(e.seriesId);
      if (!cur || (cur.end <= now && e.end > now)) lead.set(e.seriesId, e);
    }
  }
  const isLead = (e) => !e.seriesId || mode === "day" || lead.get(e.seriesId)?.id === e.id;

  let freeRun = [];
  const flushFree = () => {
    if (!freeRun.length) return;
    const a = freeRun[0], b = freeRun[freeRun.length - 1];
    const label = freeRun.length === 1
      ? `${fmt.dow.format(a)} ${a.getDate()}`
      : a.getMonth() === b.getMonth()
        ? `${a.getDate()}–${b.getDate()} ${fmt.monthShort.format(a)}`
        : `${fmt.monthShort.format(a)} ${a.getDate()} – ${fmt.monthShort.format(b)} ${b.getDate()}`;
    root.append(h("div", { class: `free-run${b < today ? " past" : ""}` },
      h("span", { class: "fr-days", text: label }), h("span", { class: "fr-txt", text: "Nothing planned" })));
    freeRun = [];
  };

  for (const day of days) {
    // Multi-day all-day events are listed once: on their first day in this range.
    const list = eventsOn(day, events).filter((e) => !e.allDay || sameDay(day, e.start < rangeStart ? rangeStart : e.start));
    const isToday = sameDay(day, today);
    // The Completed tab lists only days with something done: no free days, no forced today.
    if (!list.length && (!isToday || ctx.completed)) {
      if (mode === "week" && !ctx.completed) freeRun.push(day);
      continue;
    }
    flushFree();
    shown++;

    const group = h("div", { class: `day${isToday ? " today" : ""}${day < today ? " past" : ""}`, dataset: { day: day.toDateString() } });
    const head = mode === "day"
      ? h("header", { class: "day-h" },
        h("span", { class: "dh-num", text: day.getDate() }),
        h("span", { class: "dh-words" },
          h("span", { class: "dh-dow", text: isToday ? `Today · ${fmt.dowLong.format(day)}` : fmt.dowLong.format(day) }),
          h("span", { class: "dh-mon", text: `${fmt.month.format(day)} ${day.getFullYear()}` })))
      : h("header", { class: "day-h" },
        h("span", { class: "dh-dow", text: isToday ? "Today" : fmt.dow.format(day) }),
        h("span", { class: "dh-num", text: day.getDate() }),
        h("span", { class: "dh-mon", text: fmt.monthShort.format(day) }));
    // The sun arc needs Day view's room; at Week and Month size it reads as a smudge.
    if (isToday && mode === "day") head.append(sunArc(now));
    if (mode !== "day" && ctx.openDay) {
      head.classList.add("link");
      head.setAttribute("role", "button");
      head.tabIndex = 0;
      head.setAttribute("aria-label", `Open ${fmt.long.format(day)}`);
      head.addEventListener("click", () => ctx.openDay(day));
      head.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ctx.openDay(day); } });
    }
    const ol = h("ol", { class: "cards" });
    // The "Now" line separates past from upcoming; a live event shows "Now" itself.
    const hasLive = list.some((e) => !e.allDay && e.start <= now && e.end > now);
    let nowPlaced = !isToday || hasLive || !!ctx.completed;
    let part = 0, prev = null;
    for (const unit of overlapUnits(list, day)) {
      const { ev } = unit;
      // Noon and Evening markers go before the first event that starts in each,
      // and on the right side of the Now line: before it once the hour has passed.
      // Never between overlapping cards, which would pull them apart.
      let mark = null;
      if (!ev.allDay) {
        const p = partOf(ev.start < day ? day : ev.start);
        if (p > part) { part = p; if (!unit.tucked) mark = partMark(day, PARTS[p - 1], now); }
      }
      if (!nowPlaced && !ev.allDay && ev.start > now) {
        if (mark?.classList.contains("past")) { ol.append(mark); mark = null; }
        ol.append(nowMark(now), nowGap(now, ev));
        nowPlaced = true;
      }
      if (mark) ol.append(mark);
      const from = ev.allDay ? day : ev.start < day ? day : ev.start;
      const below = unit.tucked ? prev?.ev : null;
      prev = unit;
      const stacked = unit.tucked || unit.under;
      const li = h("li", { class: `slot sky-${ev.allDay ? "allday" : skyOf(from)}${ev.end <= now ? " past" : ""}${unit.tucked ? " dk-tuck" : ""}${unit.under ? " dk-under" : ""}${unit.sameStart ? " dk-same" : ""}`,
        dataset: { sky: ev.allDay ? "dawn" : skyOf(from), ...(stacked ? { run: unit.run } : {}), ...(unit.tucked ? { at: unit.at.toFixed(3) } : {}) },
        vars: unit.tucked ? { "--dk-depth": unit.depth } : null },
        clock(ev, day), card(ev, now, ctx, isLead(ev), { top: unit.tucked, stacked, overlaps: below?.title,
          // shown in the card when the time column has no room for it (see stackRuns)
          atTime: unit.tucked && !unit.sameStart ? fmt.time.format(from) : null }));
      // Spread out, tapping beside the cards (the time column) stacks them again.
      if (stacked) li.addEventListener("click", (e) => { if (li.classList.contains("dk-open") && !e.target.closest(".card")) spreadRun(li, false); });
      ol.append(li);
    }
    // Today always shows the Now line, even with nothing timed (or nothing at all) on it.
    if (!nowPlaced) ol.append(nowMark(now));
    if (!list.length) ol.append(h("li", { class: "day-empty", text: "Nothing planned today" }));
    paintStrip(ol, day < today);
    group.append(head, ol);
    root.append(group);
  }
  flushFree();

  // ctx.empty: signed out, no calendar connected yet. Empty days would read
  // as "you have nothing planned", so show only the note.
  if (!shown || ctx.empty) {
    const empty = ctx.empty || (ctx.completed
      ? { title: "Nothing done yet", text: `Events you mark as done ${mode === "day" ? "on this day" : `this ${mode}`} show up here. Swipe a card, or open it and choose Done.` }
      : { title: mode === "day" ? "A free day" : "Nothing planned", text: "Events you add in Google Calendar will show up here." });
    root.replaceChildren(h("div", { class: "agenda-empty" }, h("strong", { text: empty.title }), h("span", { text: empty.text })));
  }
  if (ctx.completed) root.prepend(h("div", { class: "agenda-tab" }, h("h2", { class: "at-title", text: "Completed" }),
    ctx.leaveTab ? h("button", { class: "link-btn at-back", type: "button", text: "Back to plans", onclick: ctx.leaveTab }) : null));
  watchStacks(root);
  return root;
}

// A tucked card sits as far down the card below it as its start is into that event,
// so events that start together start at the same height. Card heights are only
// known once laid out (photo cards are taller), so this runs whenever a stacked row
// changes size, which includes the first layout after the list is attached.
const MIN_OVER = 22; // a card starting near the end still covers this much
const LABEL_ROOM = 30; // below this, the start time moves from the column into the card
// Also exported, so a re-render can place stacks before measuring for its animation.
export function stackRuns(root) {
  for (const li of root.querySelectorAll(".cards > li.dk-tuck")) {
    const below = li.previousElementSibling, h = below?.offsetHeight;
    if (!h) continue;
    const gap = parseFloat(getComputedStyle(li.parentElement).rowGap) || 0;
    const o = Math.min(Math.round(+li.dataset.at * h), h - MIN_OVER);
    li.style.setProperty("--dk-pull", `${o - h - gap}px`);
    li.classList.toggle("dk-notime", o < LABEL_ROOM);
  }
}
function watchStacks(root) {
  const rows = root.querySelectorAll(".cards > li[data-run]");
  if (!rows.length) return;
  let attached = false;
  const ro = new ResizeObserver(() => {
    if (!root.isConnected) { if (attached) ro.disconnect(); return; }
    attached = true;
    stackRuns(root);
  });
  rows.forEach((li) => ro.observe(li));
}

// Landmarks in the day, so the eye finds afternoon and evening plans without
// reading times. Morning needs none: it is the top of every day.
const svg = (d) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("class", "pm-ic");
  el.innerHTML = d;
  return el;
};
const PARTS = [
  { key: "noon", label: "Noon", hour: 12,
    icon: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>' },
  { key: "evening", label: "Evening", hour: 17,
    icon: '<path d="M7.5 16a4.5 4.5 0 0 1 9 0"/><path d="M3 16h18M6 20h12M12 5.5v3M5.3 9.3l1.8 1.8M18.7 9.3l-1.8 1.8M2.5 13h2M19.5 13h2"/>' },
];
const partOf = (d) => { const hr = d.getHours(); return hr >= 17 ? 2 : hr >= 12 ? 1 : 0; };

function partMark(day, p, now) {
  const at = new Date(day); at.setHours(p.hour, 0, 0, 0);
  return h("li", { class: `part-mark pm-${p.key}${at <= now ? " past" : ""}`, dataset: { sky: skyOf(at) }, "aria-label": `${p.label}, from ${fmt.time.format(at)}` },
    h("span", { class: "pm-badge", "aria-hidden": "true" }, svg(p.icon)),
    h("span", { class: "pm-label", "aria-hidden": "true", text: p.label }),
    h("span", { class: "pm-time", "aria-hidden": "true", text: fmt.hour.format(at) }));
}

// The Now line's mark on the strip: a sun by day, a crescent moon at night (9 PM to
// 6 AM, the same span the header's sun arc treats as night).
const NOW_SUN = '<circle class="nm-disc" cx="12" cy="12" r="5"/><path class="nm-rays" d="M12 1.8v2.4M12 19.8v2.4M1.8 12h2.4M19.8 12h2.4M4.8 4.8l1.7 1.7M17.5 17.5l1.7 1.7M4.8 19.2l1.7-1.7M17.5 6.5l1.7-1.7"/>';
const NOW_MOON = '<path class="nm-moon" d="M18.3 14.9A7.2 7.2 0 0 1 9.1 5.7a7.2 7.2 0 1 0 9.2 9.2Z"/>';

function nowMark(now) {
  const night = skyOf(now) === "night";
  const icon = svg(night ? NOW_MOON : NOW_SUN);
  icon.setAttribute("class", "nm-ic");
  return h("li", { class: "now-mark", dataset: { sky: skyOf(now) }, "aria-label": `Now, ${fmt.time.format(now)}` },
    h("span", { class: "nm-pill", text: "Now" }), h("span", { class: "nm-time", text: fmt.time.format(now) }),
    h("span", { class: `nm-sun${night ? " night" : ""}`, "aria-hidden": "true" }, icon));
}

// The sky strip: a muted track behind the duration bars. Each row paints its own
// piece, fading from its sky into the next row's, so it runs from dawn to night
// without gaps. Time already gone is grey: every row of a past day, and today's rows
// up to the Now line (or ones that have ended, when a live event stands in for it).
function paintStrip(ol, dayPast) {
  const rows = [...ol.children].filter((li) => li.dataset.sky);
  const nowAt = rows.findIndex((li) => li.classList.contains("now-mark"));
  const gone = (li, i) => dayPast || (nowAt >= 0 ? i < nowAt : li.classList.contains("past"));
  const tone = (li, i) => (gone(li, i) ? "past" : li.dataset.sky);
  rows.forEach((li, i) => {
    const next = rows[i + 1];
    li.style.setProperty("--st-a", `var(--strip-${i === nowAt ? "past" : tone(li, i)})`);
    li.style.setProperty("--st-b", `var(--strip-${next && !gone(li, i) ? tone(next, i + 1) : tone(li, i)})`);
    if (i === 0) li.classList.add("st-first");
    if (i === rows.length - 1) li.classList.add("st-last");
  });
}

// The free time between now and today's next event: a dotted thread from the Now
// pill to that card, taller the longer the wait (log
// scale, so a free afternoon doesn't push the card off screen), with a countdown.
function nowGap(now, next) {
  const mins = Math.max(1, Math.ceil((next.start - now) / 60000));
  const k = Math.min(1, Math.max(0, Math.log(mins / 10) / Math.log(48)));
  const hrs = Math.floor(mins / 60), rest = mins % 60;
  const left = hrs ? `${hrs}h${rest ? ` ${rest}m` : ""}` : `${mins}m`;
  return h("li", {
    class: `now-gap${mins <= 15 ? " soon" : ""}`,
    vars: { "--gap-h": `${Math.round(40 + 48 * k)}px` },
    "aria-label": `${duration(mins * 60000)} until ${next.title}`,
  },
  h("span", { class: "ng-thread", "aria-hidden": "true" }),
  h("span", { class: "ng-text", "aria-hidden": "true" },
    h("span", { class: "ng-left", text: left }),
    h("span", { class: "ng-until", text: `until ${next.title}` })));
}

// The sky at an hour, which tints the time column: AM/PM, the duration bar, Noon and Evening.
const SKY = [[6, "night"], [9, "dawn"], [12, "morning"], [17, "afternoon"], [21, "evening"], [24, "night"]];
export const skyOf = (d) => SKY.find(([end]) => d.getHours() < end)[1];

// "3:00" and "PM" apart, so the digits can be big and the period small.
function clockParts(d) {
  const parts = fmt.time.formatToParts(d);
  const period = parts.find((p) => p.type === "dayPeriod")?.value || "";
  return { main: parts.filter((p) => p.type !== "dayPeriod").map((p) => p.value).join("").trim(), period };
}

// The time column beside each card: a big start time, its AM/PM, the end time, and
// a bar in the sky's color that grows with the event's length (0.4 px a minute).
// The card's aria-label already reads the time, so this is for the eye only.
function clock(ev, day) {
  if (ev.allDay) return h("span", { class: "c-clock", "aria-hidden": "true" }, h("span", { class: "ck-word", text: "All day" }));
  const next = addDays(day, 1);
  const cont = ev.start < day;
  const s = clockParts(cont ? ev.end : ev.start), e = clockParts(ev.end);
  const mins = (Math.min(+ev.end, +next) - Math.max(+ev.start, +day)) / 60000;
  const showEnd = !cont && ev.end > ev.start && ev.end <= next;
  return h("span", { class: "c-clock", "aria-hidden": "true", vars: { "--dur": Math.max(0, Math.round(mins)) } },
    cont ? h("span", { class: "ck-word", text: "until" }) : null,
    h("span", { class: "ck-time", text: s.main }),
    s.period ? h("span", { class: "ck-ap", text: s.period }) : null,
    showEnd ? h("span", { class: "ck-end", text: e.period && e.period !== s.period ? `${e.main} ${e.period}` : e.main }) : null,
    h("i", { class: "ck-bar" }));
}

// Today's header: a sun on an arc from 6 AM to 9 PM, so a glance says how much of the
// day is left. A fixed span (no sunrise data needed); outside it, a moon at either end.
function sunArc(now) {
  const t = (now.getHours() * 60 + now.getMinutes() - 360) / (15 * 60);
  const k = Math.min(1, Math.max(0, t));
  const x = (32 - 26 * Math.cos(Math.PI * k)).toFixed(1), y = (30 - 26 * Math.sin(Math.PI * k)).toFixed(1);
  const done = k > 0 ? `<path class="sa-done" d="M6 30A26 26 0 0 1 ${x} ${y}"/>` : "";
  const body = t < 0 || t > 1
    ? `<path class="sa-moon" transform="translate(${x - 5} ${y - 5})" d="M8.5 6.6A4 4 0 0 1 3.4 1.5a4 4 0 1 0 5.1 5.1Z"/>`
    : `<circle class="sa-halo" cx="${x}" cy="${y}" r="7"/><circle class="sa-sun" cx="${x}" cy="${y}" r="4"/>`;
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 64 34");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("class", `dh-sun${t < 0 || t > 1 ? " night" : ""}`);
  el.dataset.progress = k.toFixed(3);
  el.innerHTML = `<path class="sa-track" d="M6 30A26 26 0 0 1 58 30"/><path class="sa-ground" d="M2 30H62"/>${done}${body}`;
  return el;
}

function whenLabel(ev) {
  if (ev.allDay) {
    const days = Math.round((ev.end - ev.start) / 86400000);
    return days > 1 ? `${fmt.short.format(ev.start)} – ${fmt.short.format(addDays(ev.end, -1))}` : "All day";
  }
  if (!sameDay(ev.start, new Date(ev.end - 1))) return `${fmt.short.format(ev.start)}, ${fmt.time.format(ev.start)} – ${fmt.short.format(ev.end)}, ${fmt.time.format(ev.end)}`;
  return timeRange(ev.start, ev.end);
}

// Overlapping cards stack (tucked over each other). A tap on a stacked card spreads
// its whole run apart instead of opening it, so each card can be read whole; spread,
// cards open as usual.
function spreadRun(li, open) {
  // Animate only this change, not every render's first placement.
  const ol = li.parentElement;
  ol.classList.add("dk-anim");
  clearTimeout(ol._dkAnim);
  ol._dkAnim = setTimeout(() => ol.classList.remove("dk-anim"), 450);
  for (const r of li.parentElement.querySelectorAll(`:scope > li[data-run="${li.dataset.run}"]`)) {
    r.classList.toggle("dk-open", open);
    r.querySelector(".card")?.setAttribute("aria-expanded", String(open));
  }
}

// A plain card's tile: a calendar glyph in the calendar's color, in the slot a
// thumbnail takes, so titles line up down the day.
function calTile() {
  const el = h("span", { class: "c-tile", "aria-hidden": "true" });
  el.innerHTML = `<svg class="ic" viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;
  return el;
}

// big: photo card, the whole photo beside the text (over a blurred copy of it, with immersive cards). Otherwise a compact row, with a small thumbnail when the event has a photo.
// opts.top: the card is tucked over the one before it, whose title is opts.overlaps.
// opts.stacked: part of a run of overlapping cards, which a tap spreads apart.
function card(ev, now, ctx, lead, opts = {}) {
  const hasPhoto = expectsPhoto(ev);
  const big = hasPhoto && lead;
  const live = !ev.allDay && ev.start <= now && ev.end > now;
  const past = ev.end <= now;
  const done = !!ctx.done?.(ev);
  const multi = ev.allDay ? ev.end - ev.start > 86400000 * 1.5 : !sameDay(ev.start, new Date(ev.end - 1));
  const sub = [!ev.allDay && !live && !multi && ev.end > ev.start ? duration(ev.end - ev.start) : null, ev.location?.split("\n")[0]].filter(Boolean).join(" · ");
  const art = big ? h("span", { class: "c-art" }, h("span", { class: "ph" })) : null;
  const thumb = hasPhoto && !big ? h("span", { class: "c-thumb", vars: { "--c": ev.color } }, h("span", { class: "ph" })) : null;
  const tile = !big && !thumb ? (ev.untitled
    ? h("span", { class: "c-tile c-tile-blank", "aria-hidden": "true" })
    : calTile()) : null;
  const el = h("button", {
    class: `card ${big ? "photo" : "plain"}${thumb || tile ? " has-thumb" : ""}${ev.allDay ? " allday" : ""}${past ? " past" : ""}${live ? " live" : ""}${opts.top ? " dk-top" : ""}${done ? " done" : ""}`,
    type: "button",
    dataset: { id: ev.id },
    vars: { "--c": ev.color, "--progress": live ? ((now - ev.start) / (ev.end - ev.start)).toFixed(3) : 0 },
    "aria-label": `${ev.title}, ${whenLabel(ev)}${ev.location ? `, ${ev.location}` : ""}${opts.overlaps ? `, overlaps ${opts.overlaps}` : ""}${done ? ", done" : ""}`,
    "aria-expanded": opts.stacked ? "false" : null,
    onclick: (e) => {
      const li = e.currentTarget.closest("li[data-run]");
      if (li && !li.classList.contains("dk-open")) spreadRun(li, true);
      else ctx.openEvent(ev, e.currentTarget);
    },
  },
  big ? h("span", { class: "c-glow", "aria-hidden": "true" }) : null,
  art,
  thumb,
  tile,
  h("span", { class: "c-body" },
    // The time column says when; the card only adds what it can't: "Now" or a span of days.
    live || multi ? h("span", { class: "c-when" },
      live ? h("span", { class: "c-live", text: "Now" }) : null,
      h("span", { text: live ? `${duration(ev.end - now)} left` : whenLabel(ev) })) : null,
    h("span", { class: `c-title${ev.untitled ? " c-title-untitled" : ""}`, text: ev.title }),
    // One meta line: how long and where, then which calendar.
    h("span", { class: "c-meta" },
      sub || opts.atTime ? h("span", { class: "c-loc" },
        opts.atTime ? h("span", { class: "c-at", text: sub ? `${opts.atTime} · ` : opts.atTime }) : null, sub) : null,
      h("span", { class: "c-cal" }, h("span", { class: "dot" }), h("span", { class: "c-cal-name", text: ev.calName })))));
  if (big) paintPhoto(art, ev);
  else if (thumb) paintPhoto(thumb, ev);
  return el;
}
