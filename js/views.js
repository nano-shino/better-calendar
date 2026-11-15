// Month grid and the Day/Week time grid. Pure rendering: main.js owns state.
import { h, addDays, startOfDay, startOfWeek, sameDay, minutesOf, fmt, timeRange, shortTime, DAY } from "./util.js";
import { photoFor, cachedPhoto, ruleFor } from "./photos.js";

const cssUrl = (u) => `url("${String(u).replace(/["\\\n]/g, (c) => encodeURIComponent(c))}")`;

// Fades a photo into el's .ph child once it has loaded. Instant if already known.
export function paintPhoto(el, ev, size = "thumb") {
  const ph = el.querySelector(":scope > .ph") || el;
  const apply = (p) => {
    if (!p) return;
    ph.style.backgroundImage = cssUrl(size === "full" ? p.url : p.thumb);
  };
  const known = cachedPhoto(ev);
  if (known !== undefined) {
    if (known) {
      apply(known);
      ph.classList.add("shown", "instant");
      // A full-size photo may still be on its way; show the thumbnail meanwhile.
      if (size === "full" && known.url !== known.thumb) {
        ph.style.backgroundImage = `${cssUrl(known.url)}, ${cssUrl(known.thumb)}`;
      }
    }
    return;
  }
  photoFor(ev).then((p) => {
    if (!p || !ph.isConnected) return;
    const img = new Image();
    img.onload = () => { apply(p); requestAnimationFrame(() => ph.classList.add("shown")); };
    img.src = size === "full" ? p.url : p.thumb;
  });
}

function featured(list) {
  return list.find((e) => ruleFor(e))
    || [...list].filter((e) => !e.allDay).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
    || list[0];
}

export function eventsOn(day, events) {
  const next = addDays(day, 1);
  return events.filter((e) => e.start < next && e.end > day && (e.allDay || e.end > e.start || sameDay(e.start, day)))
    .sort((a, b) => (b.allDay - a.allDay) || (a.start - b.start) || (b.end - a.end));
}

// ---------------- Month ----------------
export function monthGrid(anchor) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const weeks = Math.ceil((Math.round((last - start) / DAY) + 1) / 7);
  return { start, end: addDays(start, weeks * 7), weeks };
}

export function renderMonth(anchor, events, ctx) {
  const { start, weeks } = monthGrid(anchor);
  const today = startOfDay(new Date());
  const root = h("section", { class: "month", vars: { "--weeks": weeks }, "aria-label": fmt.month.format(anchor) });
  const dow = h("div", { class: "m-dow", "aria-hidden": "true" });
  for (let i = 0; i < 7; i++) dow.append(h("span", { text: fmt.dow.format(addDays(start, i)) }));
  const grid = h("div", { class: "m-grid", role: "grid" });

  for (let i = 0; i < weeks * 7; i++) {
    const day = addDays(start, i);
    const list = eventsOn(day, events);
    const out = day.getMonth() !== anchor.getMonth();
    const isToday = sameDay(day, today);
    const past = day < today;
    const label = `${fmt.long.format(day)}, ${list.length ? `${list.length} event${list.length > 1 ? "s" : ""}` : "no events"}`;
    const cell = h("button", {
      class: `m-cell${out ? " out" : ""}${isToday ? " today" : ""}${past ? " past" : ""}`,
      type: "button", "aria-label": label, onclick: () => ctx.openDay(day),
      vars: { "--i": i },
    }, h("span", { class: "m-num" }, h("span", { text: day.getDate() === 1 ? `${fmt.monthShort.format(day)} 1` : day.getDate() })));

    if (list.length) {
      const lead = featured(list);
      const tile = h("span", { class: "m-tile", vars: { "--c": lead.color } }, h("span", { class: "ph" }));
      const ul = h("span", { class: "m-list" });
      const shown = list.slice(0, 3);
      for (const e of shown) {
        ul.append(h("span", { class: "m-ev" },
          e.allDay ? null : h("span", { class: "m-t", text: shortTime(e.start) }),
          h("span", { class: "m-name", text: e.title })));
      }
      if (list.length > shown.length) ul.append(h("span", { class: "m-more", text: `${list.length - shown.length} more` }));
      tile.append(ul);
      cell.append(tile);
      paintPhoto(tile, lead);
    }
    grid.append(cell);
  }
  root.append(dow, grid);
  return root;
}

// ---------------- Day / Week time grid ----------------
// Greedy column packing for overlapping events, the way paper planners do it.
function pack(items) {
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  let cluster = [], cols = [], clusterEnd = -1;
  const flush = () => { cluster.forEach((it) => (it.n = cols.length)); cluster = []; cols = []; clusterEnd = -1; };
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush();
    const visualEnd = Math.max(it.e, it.s + 28);
    let c = cols.findIndex((end) => end <= it.s);
    if (c === -1) { c = cols.length; cols.push(visualEnd); } else cols[c] = visualEnd;
    it.col = c;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return items;
}

export function renderTimeline(days, events, ctx) {
  const today = startOfDay(new Date());
  const now = new Date();
  const root = h("section", { class: `tl${days.length === 1 ? " single" : ""}`, vars: { "--days": days.length } });

  // Header: weekday + date numeral
  const head = h("div", { class: "tl-head" }, h("span", { class: "tl-gutter" }));
  for (const d of days) {
    head.append(h("button", {
      class: `tl-dh${sameDay(d, today) ? " today" : ""}${d < today ? " past" : ""}`, type: "button",
      onclick: () => ctx.openDay(d), "aria-label": fmt.long.format(d),
    }, h("span", { class: "tl-dow", text: fmt.dow.format(d) }), h("span", { class: "tl-num", text: d.getDate() })));
  }

  // All-day lane
  const lane = h("div", { class: "tl-allday" }, h("span", { class: "tl-gutter", text: "all day" }));
  let anyAllDay = false;
  for (const d of days) {
    const col = h("div", { class: "tl-adcol" });
    for (const e of events.filter((x) => x.allDay && x.start < addDays(d, 1) && x.end > d)) {
      anyAllDay = true;
      const chip = h("button", { class: "ad-chip", type: "button", dataset: { id: e.id }, vars: { "--c": e.color }, onclick: (ev) => ctx.openEvent(e, ev.currentTarget) },
        h("span", { class: "ph" }), h("span", { class: "ad-t", text: e.title }));
      paintPhoto(chip, e);
      col.append(chip);
    }
    lane.append(col);
  }
  if (!anyAllDay) lane.classList.add("empty");

  // Hours
  const scroller = h("div", { class: "tl-scroll" });
  const body = h("div", { class: "tl-body" });
  const gutter = h("div", { class: "tl-hours", "aria-hidden": "true" });
  for (let hr = 1; hr < 24; hr++) {
    const t = new Date(today); t.setHours(hr);
    gutter.append(h("span", { class: "hr", vars: { "--h": hr }, text: fmt.hour.format(t) }));
  }
  const cols = h("div", { class: "tl-cols" });
  days.forEach((d, di) => {
    const col = h("div", { class: `tl-col${sameDay(d, today) ? " today" : ""}`, vars: { "--di": di } });
    const dayStart = d.getTime(), dayEnd = addDays(d, 1).getTime();
    const items = events
      .filter((e) => !e.allDay && e.start.getTime() < dayEnd && e.end.getTime() > dayStart)
      .map((e) => {
        const s = Math.max(e.start.getTime(), dayStart), en = Math.min(e.end.getTime(), dayEnd);
        return { ev: e, s: (s - dayStart) / 60000, e: Math.max((en - dayStart) / 60000, (s - dayStart) / 60000 + 15) };
      });
    for (const it of pack(items)) col.append(block(it, ctx, now));
    if (sameDay(d, today)) col.append(h("span", { class: "now", vars: { "--m": minutesOf(now) } }));
    cols.append(col);
  });
  if (days.some((d) => sameDay(d, today))) gutter.append(h("span", { class: "now-label", vars: { "--m": minutesOf(now) }, text: fmt.time.format(now) }));
  body.append(gutter, cols);
  scroller.append(body);
  root.append(head, lane, scroller);
  return root;
}

function block(it, ctx, now) {
  const e = it.ev;
  const mins = it.e - it.s;
  const size = mins < 40 ? "xs" : mins < 75 ? "s" : "m";
  const el = h("button", {
    class: `blk ${size}${e.end < now ? " past" : ""}${e.start <= now && e.end > now ? " live" : ""}`,
    type: "button", dataset: { id: e.id },
    vars: { "--c": e.color, "--top": it.s, "--len": mins, "--col": it.col, "--n": it.n },
    onclick: (ev) => ctx.openEvent(e, ev.currentTarget),
    "aria-label": `${e.title}, ${timeRange(e.start, e.end)}`,
  },
  h("span", { class: "ph" }),
  h("span", { class: "blk-in" },
    h("span", { class: "blk-t", text: e.title }),
    h("span", { class: "blk-time", text: size === "xs" ? fmt.time.format(e.start) : timeRange(e.start, e.end) }),
    size === "m" && e.location ? h("span", { class: "blk-loc", text: e.location.split(",")[0] }) : null));
  paintPhoto(el, e);
  return el;
}

export function updateNow(root) {
  const m = minutesOf(new Date());
  root.querySelectorAll(".now, .now-label").forEach((n) => n.style.setProperty("--m", m));
  const label = root.querySelector(".now-label");
  if (label) label.textContent = fmt.time.format(new Date());
}
