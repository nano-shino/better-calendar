// Day, Week and Month as lists: one event after another, grouped by day.
// Events with a photo get a large photo card; the rest get a compact plain card.
import { h, addDays, startOfDay, sameDay, fmt, timeRange, duration } from "./util.js";
import { photoFor, cachedPhoto, expectsPhoto } from "./photos.js";

const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, (c) => encodeURIComponent(c))}")`;

// Fades a photo into el's .ph child once it has loaded. Instant if already known.
export function paintPhoto(el, ev, size = "thumb") {
  const ph = el.querySelector(":scope > .ph");
  if (!ph) return;
  const apply = (p) => { ph.style.backgroundImage = size === "full" && p.url !== p.thumb ? `${cssUrl(p.url)}, ${cssUrl(p.thumb)}` : cssUrl(size === "full" ? p.url : p.thumb); };
  const known = cachedPhoto(ev);
  if (known !== undefined) {
    if (known) { apply(known); ph.classList.add("shown", "instant"); el.classList.remove("no-photo"); }
    else el.classList.add("no-photo");
    return;
  }
  photoFor(ev).then((p) => {
    if (!ph.isConnected) return;
    if (!p) { el.classList.add("no-photo"); return; }
    const img = new Image();
    img.onload = () => { apply(p); requestAnimationFrame(() => ph.classList.add("shown")); };
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
    if (!list.length && !isToday) {
      if (mode === "week") freeRun.push(day);
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
    let nowPlaced = !isToday || hasLive;
    for (const ev of list) {
      if (!nowPlaced && !ev.allDay && ev.start > now) {
        ol.append(nowMark(now));
        nowPlaced = true;
      }
      ol.append(h("li", {}, card(ev, now, ctx, isLead(ev))));
    }
    if (!nowPlaced && list.some((e) => !e.allDay)) ol.append(nowMark(now));
    if (!list.length) ol.append(h("li", { class: "day-empty", text: "Nothing planned today" }));
    group.append(head, ol);
    root.append(group);
  }
  flushFree();

  if (!shown) {
    root.replaceChildren(h("div", { class: "agenda-empty" },
      h("strong", { text: mode === "day" ? "A free day" : "Nothing planned" }),
      h("span", { text: "Events you add in Google Calendar will show up here." })));
  }
  return root;
}

function nowMark(now) {
  return h("li", { class: "now-mark", "aria-label": `Now, ${fmt.time.format(now)}` },
    h("span", { class: "nm-pill", text: "Now" }), h("span", { class: "nm-time", text: fmt.time.format(now) }));
}

function whenLabel(ev) {
  if (ev.allDay) {
    const days = Math.round((ev.end - ev.start) / 86400000);
    return days > 1 ? `${fmt.short.format(ev.start)} – ${fmt.short.format(addDays(ev.end, -1))}` : "All day";
  }
  if (!sameDay(ev.start, new Date(ev.end - 1))) return `${fmt.short.format(ev.start)}, ${fmt.time.format(ev.start)} – ${fmt.short.format(ev.end)}, ${fmt.time.format(ev.end)}`;
  return timeRange(ev.start, ev.end);
}

// big: photo card. Otherwise a compact row, with a small thumbnail when the event has a photo.
function card(ev, now, ctx, lead) {
  const hasPhoto = expectsPhoto(ev);
  const big = hasPhoto && lead;
  const live = !ev.allDay && ev.start <= now && ev.end > now;
  const past = ev.end <= now;
  const thumb = hasPhoto && !big ? h("span", { class: "c-thumb", vars: { "--c": ev.color } }, h("span", { class: "ph" })) : null;
  const tile = !big && !thumb ? h("span", { class: "c-tile", "aria-hidden": "true", text: (ev.title.trim()[0] || "•").toUpperCase() }) : null;
  const el = h("button", {
    class: `card ${big ? "photo" : "plain"}${thumb || tile ? " has-thumb" : ""}${ev.allDay ? " allday" : ""}${past ? " past" : ""}${live ? " live" : ""}`,
    type: "button",
    dataset: { id: ev.id },
    vars: { "--c": ev.color, "--progress": live ? ((now - ev.start) / (ev.end - ev.start)).toFixed(3) : 0 },
    "aria-label": `${ev.title}, ${whenLabel(ev)}${ev.location ? `, ${ev.location}` : ""}`,
    onclick: (e) => ctx.openEvent(ev, e.currentTarget),
  },
  big ? h("span", { class: "ph" }) : null,
  thumb,
  tile,
  h("span", { class: "c-body" },
    h("span", { class: "c-when" },
      live ? h("span", { class: "c-live", text: "Now" }) : null,
      h("span", { text: whenLabel(ev) }),
      !ev.allDay && !live ? h("span", { class: "c-dur", text: duration(ev.end - ev.start) }) : null),
    h("span", { class: "c-title", text: ev.title }),
    ev.location ? h("span", { class: "c-loc", text: ev.location.split("\n")[0] }) : null),
  h("span", { class: "c-cal" }, h("span", { class: "dot" }), h("span", { class: "c-cal-name", text: ev.calName })));
  if (big) paintPhoto(el, ev);
  else if (thumb) paintPhoto(thumb, ev);
  return el;
}
