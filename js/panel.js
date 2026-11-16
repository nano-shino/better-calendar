// Event detail sheet with the photo picker.
import { h, $, fmt, timeRange, duration, descriptionText, linkify, addDays, sameDay } from "./util.js";
import { paintPhoto } from "./views.js";
import { photoFor, ruleFor, autoQuery, search, choose, clearChoice, upload, wordsOf, themeFor, expectsPhoto } from "./photos.js";
import { getProfile } from "./store.js";

let panel, scrim, current = null, ctx = null;
let openedAt = 0;
let expandedFor = null; // event id whose photo grid the viewer expanded

export function setupPanel(context) {
  ctx = context;
  panel = $("#panel");
  scrim = $("#scrim");
  scrim.addEventListener("click", (e) => {
    // Ignore the second half of a double-click that opened the panel.
    if (e.detail > 1 || performance.now() - openedAt < 350) return;
    closePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (!current || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") { e.preventDefault(); closePanel(); return; }
    if (e.key.toLowerCase() === "x" && !e.target.closest?.("input, textarea, [contenteditable]")) { e.preventDefault(); ctx.toggleDone(current); }
  });
  setupSheetDrag();
}

// On a phone the panel is a bottom sheet: pulling it down from the top closes it.
// Only while its content is scrolled to the top, so it never fights scrolling.
const isSheet = () => matchMedia("(max-width: 720px)").matches;
function setupSheetDrag() {
  let d = null;
  panel.addEventListener("touchstart", (e) => {
    d = null;
    if (!isSheet() || e.touches.length !== 1 || panel.classList.contains("closing")) return;
    if (($(".pv-scroll", panel)?.scrollTop || 0) > 0 || e.target.closest("input, textarea")) return;
    const t = e.touches[0];
    d = { x: t.clientX, y: t.clientY, dy: 0, on: false, lastY: t.clientY, lastT: performance.now(), v: 0 };
  }, { passive: true });
  panel.addEventListener("touchmove", (e) => {
    if (!d) return;
    const t = e.touches[0];
    const dx = t.clientX - d.x, dy = t.clientY - d.y;
    if (!d.on) {
      // Decided on the first move: down and mostly vertical drags the sheet, anything else scrolls.
      if (dy > 0 && dy >= Math.abs(dx)) { d.on = true; panel.classList.add("dragging"); }
      else { d = null; return; }
    }
    if (e.cancelable) e.preventDefault();
    const now = performance.now();
    d.v = (t.clientY - d.lastY) / Math.max(1, now - d.lastT);
    d.lastY = t.clientY; d.lastT = now;
    d.dy = Math.max(0, dy);
    panel.style.transform = `translateY(${d.dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - d.dy / panel.offsetHeight));
  }, { passive: false });
  const end = () => {
    if (!d?.on) { d = null; return; }
    const { dy, v } = d;
    d = null;
    panel.classList.remove("dragging");
    if (dy > Math.min(140, panel.offsetHeight * 0.25) || (dy > 40 && v > 0.5)) { closePanel(); return; }
    panel.style.transition = "transform 0.3s var(--spring)";
    panel.style.transform = "";
    scrim.style.opacity = "";
    setTimeout(() => { panel.style.transition = ""; }, 320);
  };
  panel.addEventListener("touchend", end, { passive: true });
  panel.addEventListener("touchcancel", end, { passive: true });
}

export const panelEvent = () => current;

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let closeTimer = 0;

export function openPanel(ev) {
  clearTimeout(closeTimer);
  const wasOpen = !!current;
  if (current?.id !== ev.id) expandedFor = null;
  current = ev;
  openedAt = performance.now();
  build(ev);
  panel.classList.remove("closing");
  scrim.classList.remove("closing");
  panel.style.transform = "";
  scrim.style.opacity = "";
  panel.hidden = false;
  scrim.hidden = false;
  document.body.classList.add("panel-open");
  setInert(true);
  if (!wasOpen) {
    panel.classList.remove("opening"); void panel.offsetWidth; panel.classList.add("opening");
  }
  $(".pv-close", panel)?.focus({ preventScroll: true });
}

export function closePanel() {
  if (!current) return;
  const id = current.id;
  current = null;
  document.body.classList.remove("panel-open");
  setInert(false);
  const card = document.querySelector(`#stage [data-id="${CSS.escape(id)}"]`);
  card?.focus({ preventScroll: true });

  // Fade out without blocking the page: the panel and scrim ignore the pointer while they go.
  panel.classList.remove("opening");
  panel.classList.add("closing");
  scrim.classList.add("closing");
  closeTimer = setTimeout(() => {
    if (current) return;
    panel.hidden = true;
    scrim.hidden = true;
    panel.style.transform = "";
    scrim.style.opacity = "";
    panel.classList.remove("closing");
    scrim.classList.remove("closing");
  }, reduceMotion() ? 0 : 300);
}

// Everything behind the open sheet is taken out of tab order and clicks.
function setInert(on) {
  for (const sel of [".bar", "#banner", "#stage", "#welcome"]) {
    const el = document.querySelector(sel);
    if (el) el.inert = on;
  }
}

// Re-render the open panel after data changes, without animation.
export function refreshPanel(events) {
  if (!current) return;
  const fresh = events.find((e) => e.id === current.id);
  if (fresh) { current = fresh; build(fresh, true); }
}

function whenText(ev) {
  if (ev.allDay) {
    const last = addDays(ev.end, -1);
    return sameDay(ev.start, last) ? [fmt.long.format(ev.start), "All day"]
      : [`${fmt.short.format(ev.start)} – ${fmt.short.format(last)}`, `All day · ${Math.round((ev.end - ev.start) / 86400000)} days`];
  }
  if (!sameDay(ev.start, ev.end)) return [`${fmt.long.format(ev.start)}, ${fmt.time.format(ev.start)}`, `until ${fmt.long.format(ev.end)}, ${fmt.time.format(ev.end)}`];
  return [fmt.long.format(ev.start), `${timeRange(ev.start, ev.end)} · ${duration(ev.end - ev.start)}`];
}

function sourceLabel(ev, rule) {
  if (!rule) {
    const theme = themeFor(ev);
    if (theme && getProfile().autoPhotos !== false) return `Automatic, because the title says “${theme.label}”`;
    return "No photo yet. Pick one below.";
  }
  if (rule.scope === "event") return "You chose this for this event";
  if (rule.scope === "series") return "You chose this for every repeat";
  return `Matches your keyword “${rule.word}”`;
}

function build(ev, keepScroll, message = "") {
  const scrollTop = keepScroll ? $(".pv-scroll", panel)?.scrollTop : 0;
  const rule = ruleFor(ev);
  const [line1, line2] = whenText(ev);

  const credit = h("a", { class: "pv-credit", target: "_blank", rel: "noopener", hidden: true });
  const photo = h("div", { class: `pv-photo${expectsPhoto(ev) ? "" : " is-empty"}`, vars: { "--c": ev.color } },
    h("span", { class: "ph" }),
    h("button", { class: "pv-close", type: "button", "aria-label": "Close", onclick: closePanel }, icon("close")),
    credit);
  paintPhoto(photo, ev, "full");
  photoFor(ev).then((p) => setCredit(credit, p));

  const desc = descriptionText(ev.description);
  const details = h("div", { class: "pv-details" },
    h("p", { class: "pv-cal" }, h("span", { class: "dot", vars: { "--c": ev.color } }),
      h("span", { text: ev.calName }), ev.account !== "sample" ? h("span", { class: "pv-acct", text: ev.account }) : null),
    h("h2", { class: `pv-title${ev.untitled ? " pv-title-untitled" : ""}`, id: "pvTitle", text: ev.title }),
    h("p", { class: "pv-when" }, h("span", { text: line1 }), h("span", { class: "sub", text: line2 })),
    ev.busy ? h("p", { class: "pv-hidden-note", text: `${ev.calName} shares only when it's busy, not what the event is.` }) : null,
    ev.location ? h("p", { class: "pv-row" }, icon("pin"),
      h("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`, target: "_blank", rel: "noopener", text: ev.location })) : null,
    ev.meet ? h("p", { class: "pv-row" }, icon("video"), h("a", { href: ev.meet, target: "_blank", rel: "noopener", text: "Join video call" })) : null,
    ev.attendees > 1 ? h("p", { class: "pv-row" }, icon("people"), h("span", { text: `${ev.attendees} guests` })) : null,
    desc ? h("div", { class: "pv-desc" }, linkify(desc)) : null,
    actions(ev),
  );

  // A busy block is someone else's hidden event: nothing to choose a photo for.
  const picker = ev.busy ? null : buildPicker(ev, rule, photo, credit, message);
  const scroll = h("div", { class: "pv-scroll" }, photo, details, picker);
  panel.replaceChildren(scroll);
  panel.setAttribute("aria-labelledby", "pvTitle");
  if (keepScroll) scroll.scrollTop = scrollTop;
}

// Done (or Not done) first, then the links into Google Calendar.
function actions(ev) {
  const done = ctx.isDone(ev);
  const btn = h("button", { class: `btn small pv-done${done ? " is-done" : ""}`, type: "button", "aria-pressed": String(done),
    title: `${done ? "Mark not done" : "Mark done"} (X)`, onclick: () => ctx.toggleDone(ev) },
  icon(done ? "undo" : "check"), done ? "Not done" : "Done");
  const links = googleLinks(ev);
  return h("div", { class: "pv-links" }, btn, links ? [...links.childNodes] : null);
}

// Links into Google Calendar for the account that owns the event. The API's
// htmlLink has no account in it, so with several accounts it can open the wrong one.
function googleLinks(ev) {
  if (!ev.link) return null;
  let eid = "";
  const m = /[?&]eid=([^&#]+)/.exec(ev.link);
  if (m) { try { eid = decodeURIComponent(m[1]); } catch { eid = m[1]; } }
  if (!eid) return h("div", { class: "pv-links" }, h("a", { class: "btn small", href: ev.link, target: "_blank", rel: "noopener", text: "Open in Google Calendar" }));
  const user = ev.account && ev.account.includes("@") ? `authuser=${encodeURIComponent(ev.account)}` : "";
  const edit = `https://calendar.google.com/calendar/r/eventedit/${encodeURIComponent(eid)}${user ? `?${user}` : ""}`;
  const view = `https://calendar.google.com/calendar/event?eid=${encodeURIComponent(eid)}${user ? `&${user}` : ""}`;
  if (ev.busy) return h("div", { class: "pv-links" }, h("a", { class: "btn small", href: view, target: "_blank", rel: "noopener", text: "Open in Google Calendar" }));
  return h("div", { class: "pv-links" },
    h("a", { class: "btn small", href: edit, target: "_blank", rel: "noopener", text: "Edit in Google Calendar" }),
    h("a", { class: "link-btn", href: view, target: "_blank", rel: "noopener", text: "View" }));
}

function setCredit(el, p) {
  if (p?.credit) {
    const by = p.credit.by && p.credit.by !== "Unknown" ? p.credit.by : "";
    el.textContent = [by, p.credit.license].filter(Boolean).join(" · ") || "Photo credit";
    el.href = p.credit.link;
    el.hidden = false;
  } else if (p?.mine) {
    el.textContent = "Your photo";
    el.removeAttribute("href");
    el.hidden = false;
  } else el.hidden = true;
}

function buildPicker(ev, rule, photo, credit, message = "") {
  const word0 = ev.untitled ? "" : rule?.word || wordsOf(ev.title)[0] || ev.title.toLowerCase();
  const initial = rule?.scope || (ev.seriesId ? "series" : "event");
  const keyword = h("input", { class: "kw-input", id: "kwInput", type: "text", value: word0, "aria-label": "Keyword", autocomplete: "off", spellcheck: "false" });
  const scopeOpt = (value, label, extra) => h("label", { class: "sc-opt" },
    h("input", { type: "radio", name: "scope", value, id: `scope-${value}`, checked: initial === value }),
    h("span", { class: "sc-txt" }, label, extra || null));
  const scope = h("fieldset", { class: "scope" },
    h("legend", { text: "Use the photo for" }),
    scopeOpt("event", "This event"),
    ev.seriesId ? scopeOpt("series", "Every repeat") : null,
    ev.untitled ? null : scopeOpt("keyword", "Titles with ", keyword));
  keyword.addEventListener("focus", () => { $("#scope-keyword", scope).checked = true; });

  const getScope = () => $('input[name="scope"]:checked', scope)?.value || "event";
  const status = h("p", { class: "pk-status", role: "status", text: message });

  async function apply(pickPromise) {
    const s = getScope();
    if (s === "keyword" && !keyword.value.trim()) { keyword.focus(); status.textContent = "Type a word first."; return; }
    status.textContent = "Saving…";
    try {
      const pick = await pickPromise();
      await choose(ev, s, pick, keyword.value);
      status.textContent = ctx.signedIn() ? "Saved" : "Saved for now. Sign in to keep it.";
      const fresh = h("span", { class: "ph" });
      photo.querySelector(".ph").replaceWith(fresh);
      photo.classList.remove("is-empty");
      paintPhoto(photo, ev, "full");
      photoFor(ev).then((p) => setCredit(credit, p));
      ctx.changed();
      const saved = status.textContent;
      setTimeout(() => current?.id === ev.id && build(ev, true, saved), 650);
    } catch (err) {
      status.textContent = err.message;
    }
  }

  // Suggestions
  const q = h("input", { type: "search", id: "pkQuery", class: "pk-q", value: autoQuery(ev), placeholder: "Search photos", autocomplete: "off", "aria-label": "Search photos" });
  const results = h("div", { class: `pk-grid${expandedFor === ev.id ? "" : " collapsed"}` });
  const more = h("button", { type: "button", class: "link-btn pk-more", hidden: true, text: "More photos", onclick: () => {
    expandedFor = ev.id;
    results.classList.remove("collapsed");
    more.hidden = true;
    results.querySelectorAll(".pk-item")[3]?.focus();
  } });
  const preview = (r) => { const ph = photo.querySelector(".ph"); ph.style.backgroundImage = `url("${r.thumb}")`; ph.classList.add("shown"); };
  const restore = () => {
    const ph = photo.querySelector(".ph");
    ph.style.backgroundImage = "";
    if (!expectsPhoto(ev)) ph.classList.remove("shown");
    paintPhoto(photo, ev, "full");
  };
  async function runSearch() {
    const term = q.value.trim();
    results.replaceChildren(...Array.from({ length: results.classList.contains("collapsed") ? 3 : 9 }, () => h("span", { class: "pk-skel" })));
    more.hidden = true;
    try {
      const list = term ? await search(term, 12) : [];
      results.replaceChildren();
      if (!list.length) { results.append(h("p", { class: "pk-empty", text: term ? "No photos for that. Try a simpler word." : "Type something to search." })); return; }
      list.slice(0, 12).forEach((r, i) => {
        const b = h("button", { type: "button", class: "pk-item", vars: { "--i": i }, "aria-label": `Use photo by ${r.credit.by}`, title: `${r.credit.by} · ${r.credit.license}` });
        const img = new Image(); img.onload = () => { b.style.backgroundImage = `url("${r.thumb}")`; b.classList.add("ready"); }; img.src = r.thumb;
        b.addEventListener("pointerenter", () => preview(r));
        b.addEventListener("pointerleave", restore);
        b.addEventListener("click", () => apply(async () => ({ type: "url", url: r.url, thumb: r.thumb, credit: r.credit })));
        results.append(b);
      });
      more.hidden = !results.classList.contains("collapsed") || list.length <= 3;
    } catch (err) {
      results.replaceChildren(h("p", { class: "pk-empty", text: err.message }));
    }
  }
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });

  // Upload
  const file = h("input", { type: "file", accept: "image/*", id: "pkFile", class: "visually-hidden" });
  const drop = h("label", { class: "pk-drop", for: "pkFile" },
    icon("image"), h("span", {}, h("strong", { text: "Upload a photo" }), h("span", { class: "sub", text: "Drop, paste or choose a file" })));
  const take = (f) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { status.textContent = "That file isn't an image. Choose a JPG, PNG or similar."; return; }
    apply(() => upload(f));
  };
  file.addEventListener("change", () => take(file.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files[0]); });
  panel.onpaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); take(f); } };

  const reset = rule ? h("button", { type: "button", class: "link-btn", text: "Use the automatic photo", onclick: async () => {
    status.textContent = "Saving…";
    try { await clearChoice(ev); ctx.changed(); build(ev, true, "Back to the automatic photo"); } catch (err) { status.textContent = err.message; }
  } }) : null;

  const section = h("section", { class: "picker", "aria-label": "Photo" },
    h("div", { class: "pk-head" }, h("h3", { text: "Photo" }), h("span", { class: "pk-src", text: sourceLabel(ev, rule) })),
    scope,
    h("div", { class: "pk-search" }, icon("search"), q),
    results,
    more,
    file, drop,
    h("div", { class: "pk-foot" }, status, reset),
    h("p", { class: "fine", text: "Suggested photos come from Openverse and are Creative Commons licensed." }));
  runSearch();
  return section;
}

const ICONS = {
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><path d="M16 4.8a3 3 0 0 1 0 6M17.5 14c2 .6 3.2 2.2 3.5 5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
};
ICONS.close = '<path d="M6 6l12 12M18 6L6 18"/>';
ICONS.check = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
ICONS.undo = '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>';
// SVG must be created through the parser to get the SVG namespace.
export function icon(name) {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return t.content.firstChild;
}
