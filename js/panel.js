// Event detail sheet with the photo picker. Opens by morphing the event's photo.
import { h, $, fmt, timeRange, duration, descriptionText, linkify, transition, addDays, sameDay } from "./util.js";
import { paintPhoto } from "./views.js";
import { photoFor, ruleFor, autoQuery, search, choose, clearChoice, upload, wordsOf } from "./photos.js";

let panel, scrim, current = null, ctx = null;

export function setupPanel(context) {
  ctx = context;
  panel = $("#panel");
  scrim = $("#scrim");
  scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && current) { e.preventDefault(); closePanel(); } });
}

export const panelEvent = () => current;

export function openPanel(ev, sourceEl) {
  const srcPh = sourceEl?.querySelector(":scope > .ph.shown");
  const wasOpen = !!current;
  if (srcPh && !wasOpen) srcPh.style.viewTransitionName = "hero";
  let hero = null;
  const t = transition(() => {
    if (srcPh) srcPh.style.viewTransitionName = "";
    current = ev;
    build(ev);
    panel.hidden = false;
    scrim.hidden = false;
    document.body.classList.add("panel-open");
    hero = srcPh ? $(".pv-photo > .ph", panel) : null;
    if (hero) hero.style.viewTransitionName = "hero";
  }, wasOpen ? "swap" : "open");
  t.done.then(() => $(".pv-close", panel)?.focus({ preventScroll: true }));
  t.finished.then(() => { if (hero) hero.style.viewTransitionName = ""; });
}

export function closePanel() {
  if (!current) return;
  const id = current.id;
  const hero = $(".pv-photo > .ph", panel);
  if (hero) hero.style.viewTransitionName = "hero";
  let target = null;
  const t = transition(() => {
    if (hero) hero.style.viewTransitionName = "";
    panel.hidden = true;
    scrim.hidden = true;
    document.body.classList.remove("panel-open");
    current = null;
    target = document.querySelector(`#stage [data-id="${CSS.escape(id)}"] > .ph.shown`);
    if (target) target.style.viewTransitionName = "hero";
  }, "close");
  t.finished.then(() => { if (target) target.style.viewTransitionName = ""; });
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
  if (!rule) return "Picked automatically from the title";
  if (rule.scope === "event") return "You chose this for this event";
  if (rule.scope === "series") return "You chose this for every repeat";
  return `Matches your keyword “${rule.word}”`;
}

function build(ev, keepScroll) {
  const scrollTop = keepScroll ? $(".pv-scroll", panel)?.scrollTop : 0;
  const rule = ruleFor(ev);
  const [line1, line2] = whenText(ev);

  const credit = h("a", { class: "pv-credit", target: "_blank", rel: "noopener", hidden: true });
  const photo = h("div", { class: "pv-photo", vars: { "--c": ev.color } },
    h("span", { class: "ph" }),
    h("button", { class: "pv-close", type: "button", "aria-label": "Close", onclick: closePanel }, icon("close")),
    credit);
  paintPhoto(photo, ev, "full");
  photoFor(ev).then((p) => setCredit(credit, p));

  const desc = descriptionText(ev.description);
  const details = h("div", { class: "pv-details" },
    h("p", { class: "pv-cal" }, h("span", { class: "dot", vars: { "--c": ev.color } }),
      h("span", { text: ev.calName }), ev.account !== "sample" ? h("span", { class: "pv-acct", text: ev.account }) : null),
    h("h2", { class: "pv-title", id: "pvTitle", text: ev.title }),
    h("p", { class: "pv-when" }, h("span", { text: line1 }), h("span", { class: "sub", text: line2 })),
    ev.location ? h("p", { class: "pv-row" }, icon("pin"),
      h("a", { href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ev.location)}`, target: "_blank", rel: "noopener", text: ev.location })) : null,
    ev.meet ? h("p", { class: "pv-row" }, icon("video"), h("a", { href: ev.meet, target: "_blank", rel: "noopener", text: "Join video call" })) : null,
    ev.attendees > 1 ? h("p", { class: "pv-row" }, icon("people"), h("span", { text: `${ev.attendees} guests` })) : null,
    desc ? h("div", { class: "pv-desc" }, linkify(desc)) : null,
    ev.link ? h("a", { class: "pv-open", href: ev.link, target: "_blank", rel: "noopener", text: "Open in Google Calendar" }) : null,
  );

  const picker = buildPicker(ev, rule, photo, credit);
  const scroll = h("div", { class: "pv-scroll" }, photo, details, picker);
  panel.replaceChildren(scroll);
  panel.setAttribute("aria-labelledby", "pvTitle");
  if (keepScroll) scroll.scrollTop = scrollTop;
}

function setCredit(el, p) {
  if (p?.credit) {
    el.textContent = p.credit.license ? `${p.credit.by} · ${p.credit.license}` : p.credit.by;
    el.href = p.credit.link;
    el.hidden = false;
  } else if (p?.mine) {
    el.textContent = "Your photo";
    el.removeAttribute("href");
    el.hidden = false;
  } else el.hidden = true;
}

function buildPicker(ev, rule, photo, credit) {
  const word0 = rule?.word || wordsOf(ev.title)[0] || ev.title.toLowerCase();
  const initial = rule?.scope || (ev.seriesId ? "series" : "event");
  const keyword = h("input", { class: "kw-input", id: "kwInput", type: "text", value: word0, "aria-label": "Keyword", autocomplete: "off", spellcheck: "false" });
  const scopeOpt = (value, label, extra) => h("label", { class: "sc-opt" },
    h("input", { type: "radio", name: "scope", value, id: `scope-${value}`, checked: initial === value }),
    h("span", { class: "sc-txt" }, label, extra || null));
  const scope = h("fieldset", { class: "scope" },
    h("legend", { text: "Use the photo for" }),
    scopeOpt("event", "This event"),
    ev.seriesId ? scopeOpt("series", "Every repeat") : null,
    scopeOpt("keyword", "Titles with ", keyword));
  keyword.addEventListener("focus", () => { $("#scope-keyword", scope).checked = true; });

  const getScope = () => $('input[name="scope"]:checked', scope)?.value || "event";
  const status = h("p", { class: "pk-status", role: "status" });

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
      paintPhoto(photo, ev, "full");
      photoFor(ev).then((p) => setCredit(credit, p));
      ctx.changed();
      setTimeout(() => current?.id === ev.id && build(ev, true), 650);
    } catch (err) {
      status.textContent = err.message;
    }
  }

  // Suggestions
  const q = h("input", { type: "search", id: "pkQuery", class: "pk-q", value: autoQuery(ev), placeholder: "Search photos", autocomplete: "off", "aria-label": "Search photos" });
  const results = h("div", { class: "pk-grid" });
  const preview = (r) => { const ph = photo.querySelector(".ph"); ph.style.backgroundImage = `url("${r.thumb}")`; ph.classList.add("shown"); };
  const restore = () => { photo.querySelector(".ph").style.backgroundImage = ""; paintPhoto(photo, ev, "full"); };
  async function runSearch() {
    const term = q.value.trim();
    results.replaceChildren(...Array.from({ length: 9 }, () => h("span", { class: "pk-skel" })));
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
    } catch (err) {
      results.replaceChildren(h("p", { class: "pk-empty", text: err.message }));
    }
  }
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });

  // Upload
  const file = h("input", { type: "file", accept: "image/*", id: "pkFile", class: "visually-hidden" });
  const drop = h("label", { class: "pk-drop", for: "pkFile" },
    icon("image"), h("span", {}, h("strong", { text: "Upload a photo" }), h("span", { class: "sub", text: "Drop, paste or choose a file" })));
  const take = (f) => f && f.type.startsWith("image/") && apply(() => upload(f));
  file.addEventListener("change", () => take(file.files[0]));
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files[0]); });
  panel.onpaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); take(f); } };

  const reset = rule ? h("button", { type: "button", class: "link-btn", text: "Use the automatic photo", onclick: async () => {
    status.textContent = "Saving…";
    try { await clearChoice(ev); ctx.changed(); build(ev, true); } catch (err) { status.textContent = err.message; }
  } }) : null;

  const section = h("section", { class: "picker", "aria-label": "Photo" },
    h("div", { class: "pk-head" }, h("h3", { text: "Photo" }), h("span", { class: "pk-src", text: sourceLabel(ev, rule) })),
    scope,
    h("div", { class: "pk-search" }, icon("search"), q),
    results,
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
// SVG must be created through the parser to get the SVG namespace.
export function icon(name) {
  const t = document.createElement("template");
  t.innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return t.content.firstChild;
}
