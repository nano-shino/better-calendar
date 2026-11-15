// App shell: header, navigation, data loading, accounts.
import { h, $, startOfDay, addDays, addMonths, startOfWeek, sameDay, fmt, transition, loadJSON, saveJSON } from "./util.js";
import { renderMonth, renderTimeline, monthGrid, updateNow } from "./views.js";
import { setupPanel, openPanel, closePanel, refreshPanel, panelEvent, icon } from "./panel.js";
import * as store from "./store.js";
import * as google from "./google.js";
import { googleClientId } from "./config.js";
import { sampleEvents, sampleCalendars } from "./sample.js";
import { resetMemo, removeKeyword } from "./photos.js";

const mobile = matchMedia("(max-width: 720px)");

const S = {
  view: loadJSON("bd:view", null) || (mobile.matches ? "day" : "week"),
  anchor: startOfDay(new Date()),
  events: [],
  calendars: new Map(),       // account email -> calendar list
  reconnect: new Set(),       // account emails whose token expired
  signedIn: false,
  gis: false,
  cache: new Map(),           // `${email}|${start}|${end}` -> {t, events}
  seq: 0,
};

const stage = $("#stage");

// ---------------- ranges ----------------
function rangeOf(view, anchor) {
  if (view === "month") { const g = monthGrid(anchor); return { start: g.start, end: g.end }; }
  if (view === "day") return { start: anchor, end: addDays(anchor, 1) };
  if (mobile.matches) return { start: anchor, end: addDays(anchor, 3) };
  const s = startOfWeek(anchor);
  return { start: s, end: addDays(s, 7) };
}
function shift(view, anchor, dir) {
  if (view === "month") return addMonths(anchor, dir);
  if (view === "day") return addDays(anchor, dir);
  return addDays(anchor, dir * (mobile.matches ? 3 : 7));
}

// ---------------- data ----------------
const FRESH = 5 * 60 * 1000;
const visible = (e) => !store.getProfile().hidden.includes(e.calKey);

async function accountEvents(email, start, end) {
  const key = `${email}|${+start}|${+end}`;
  const hit = S.cache.get(key);
  if (hit && Date.now() - hit.t < FRESH) return hit.events;
  try {
    let cals = S.calendars.get(email);
    if (!cals) { cals = await google.listCalendars(email); S.calendars.set(email, cals); }
    const lists = await Promise.all(cals.map((c) => google.listEvents(c, start, end).catch((err) => {
      if (err.reauth) throw err;
      console.warn("Skipped calendar", c.name, err);
      return [];
    })));
    const events = lists.flat();
    S.cache.set(key, { t: Date.now(), events });
    S.reconnect.delete(email);
    return events;
  } catch (err) {
    if (err.reauth) { S.reconnect.add(email); return hit ? hit.events : []; }
    toast(`Couldn't load ${email}: ${err.message}`);
    return hit ? hit.events : [];
  }
}

async function eventsFor(start, end) {
  if (!S.signedIn) return sampleEvents(start, end);
  const lists = await Promise.all(store.getProfile().accounts.map((a) => accountEvents(a.email, start, end)));
  // The same meeting can show up in several of your accounts. Keep one.
  const seen = new Set();
  return lists.flat().filter((e) => {
    const k = `${e.uid}|${+e.start}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function calendarsList() {
  if (!S.signedIn) return [{ account: "Sample calendars", cals: sampleCalendars }];
  return store.getProfile().accounts.map((a) => ({ account: a.email, cals: S.calendars.get(a.email) || [] }));
}

// ---------------- navigation ----------------
async function go({ view = S.view, anchor = S.anchor, kind = null, quiet = false } = {}) {
  const seq = ++S.seq;
  const { start, end } = rangeOf(view, anchor);
  const slow = setTimeout(() => document.body.classList.add("loading"), 180);
  const events = await eventsFor(start, end);
  clearTimeout(slow);
  if (seq !== S.seq) return;
  document.body.classList.remove("loading");
  const viewChanged = view !== S.view;
  S.view = view; S.anchor = anchor; S.events = events;
  saveJSON("bd:view", view);
  const paint = () => render(viewChanged);
  if (quiet || !kind) paint(); else transition(paint, kind);
  renderBanner();
  refreshPanel(S.events);
  if (S.signedIn) prefetch(view, anchor);
}

function prefetch(view, anchor) {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 400));
  idle(() => {
    for (const dir of [1, -1]) { const r = rangeOf(view, shift(view, anchor, dir)); eventsFor(r.start, r.end); }
  });
}

const nav = (dir) => go({ anchor: shift(S.view, S.anchor, dir), kind: dir > 0 ? "next" : "prev" });
const goToday = () => {
  const today = startOfDay(new Date());
  const { start, end } = rangeOf(S.view, S.anchor);
  const kind = today < start ? "prev" : today >= end ? "next" : null;
  go({ anchor: today, kind });
  if (!kind) scrollToNow(true);
};
const setView = (view, anchor = S.anchor) => {
  if (view === S.view && sameDay(anchor, S.anchor)) return;
  const order = { day: 0, week: 1, month: 2 };
  go({ view, anchor, kind: order[view] < order[S.view] ? "zoom-in" : order[view] > order[S.view] ? "zoom-out" : null });
};

// ---------------- rendering ----------------
let lastScroll = null;

function render(viewChanged) {
  const oldScroller = $(".tl-scroll", stage);
  if (oldScroller) lastScroll = oldScroller.scrollTop;
  const events = S.events.filter(visible);
  const ctx = { openEvent: (e, el) => openPanel(e, el), openDay: (d) => setView("day", startOfDay(d)) };

  let view;
  if (S.view === "month") view = renderMonth(S.anchor, events, ctx);
  else {
    const { start, end } = rangeOf(S.view, S.anchor);
    const days = [];
    for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
    view = renderTimeline(days, events, ctx);
  }
  stage.replaceChildren(view);
  stage.dataset.view = S.view;

  const scroller = $(".tl-scroll", stage);
  if (scroller) {
    if (lastScroll == null || viewChanged) scrollToNow(false);
    else scroller.scrollTop = lastScroll;
  }
  renderHeader();
}

function scrollToNow(smooth) {
  const scroller = $(".tl-scroll", stage);
  if (!scroller) return;
  const hourPx = parseFloat(getComputedStyle(stage).getPropertyValue("--hour")) || 52;
  const { start, end } = rangeOf(S.view, S.anchor);
  const now = new Date();
  const showsToday = now >= start && now < end;
  const firstEvent = S.events.filter((e) => !e.allDay && visible(e)).map((e) => e.start.getHours() + e.start.getMinutes() / 60).sort((a, b) => a - b)[0];
  const hour = showsToday ? now.getHours() + now.getMinutes() / 60 - 1.5 : Math.min(firstEvent ?? 8, 8) - 0.5;
  scroller.scrollTo({ top: Math.max(0, hour * hourPx), behavior: smooth ? "smooth" : "instant" });
}

function renderHeader() {
  const { start, end } = rangeOf(S.view, S.anchor);
  const last = addDays(end, -1);
  const ref = S.view === "month" ? S.anchor : start;
  let month = fmt.month.format(ref), year = String(ref.getFullYear());
  if (S.view !== "month" && start.getMonth() !== last.getMonth()) {
    month = `${fmt.monthShort.format(start)} – ${fmt.monthShort.format(last)}`;
    if (start.getFullYear() !== last.getFullYear()) year = `${start.getFullYear()}–${String(last.getFullYear()).slice(2)}`;
  }
  const title = $("#title");
  title.replaceChildren(h("span", { class: "t-month", text: month }), " ", h("span", { class: "t-year", text: year }));
  $("#seg").dataset.view = S.view;
  for (const b of document.querySelectorAll("#seg [data-v]")) b.setAttribute("aria-pressed", String(b.dataset.v === S.view));
  const today = startOfDay(new Date());
  $("#todayBtn").disabled = today >= start && today < end && (S.view !== "month" || today.getMonth() === S.anchor.getMonth());
  renderAvatars();
}

function renderAvatars() {
  const btn = $("#acctBtn");
  const accts = S.signedIn ? store.getProfile().accounts : [];
  btn.replaceChildren();
  if (!accts.length) { btn.append(h("span", { class: "av blank" }, icon("people"))); btn.setAttribute("aria-label", "Accounts"); return; }
  accts.slice(0, 3).forEach((a, i) => btn.append(avatar(a, i)));
  if (S.reconnect.size) btn.append(h("span", { class: "av-alert", "aria-hidden": "true" }));
  btn.setAttribute("aria-label", `Accounts (${accts.length})`);
}

function avatar(a, i = 0) {
  const initial = (a.name || a.email || "?").trim()[0].toUpperCase();
  const el = h("span", { class: "av", vars: { "--i": i } }, h("span", { text: initial }));
  if (a.picture) {
    const img = h("img", { alt: "", referrerpolicy: "no-referrer", src: a.picture });
    img.onerror = () => img.remove();
    el.append(img);
  }
  return el;
}

function renderBanner() {
  const box = $("#banner");
  box.replaceChildren();
  for (const email of S.reconnect) {
    box.append(h("div", { class: "bn" },
      h("span", { class: "bn-dot" }),
      h("span", { class: "bn-txt" }, "Reconnect ", h("strong", { text: email }), " to load its events."),
      h("button", { class: "btn small", type: "button", text: "Reconnect", onclick: (e) => reconnect(email, e.currentTarget) })));
  }
  box.hidden = !S.reconnect.size;
  renderWelcome();
}

function renderWelcome() {
  const card = $("#welcome");
  let dismissed = false;
  try { dismissed = sessionStorage.getItem("bd:welcome") === "0"; } catch {}
  card.hidden = S.signedIn || dismissed;
  if (card.hidden) return;
  const close = h("button", { class: "icon-btn wc-x", type: "button", "aria-label": "Hide", onclick: () => {
    try { sessionStorage.setItem("bd:welcome", "0"); } catch {}
    card.hidden = true;
  } }, icon("close"));
  card.replaceChildren(...[
    h("div", { class: "wc-text" },
      h("strong", { text: "Your calendar, with a picture for every plan." }),
      h("span", { text: store.configured ? "These are sample events. Sign in to see yours, from as many Google accounts as you like." : "These are sample events. Add your Firebase settings to js/config.js to connect your calendars (see README)." })),
    store.configured ? h("button", { class: "btn primary", type: "button", onclick: signIn }, googleMark(), "Sign in with Google") : null,
    close,
  ].filter(Boolean));
}

function googleMark() {
  const t = document.createElement("template");
  t.innerHTML = '<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  return t.content.firstChild;
}

// ---------------- accounts ----------------
async function signIn() {
  try {
    await store.signIn();
    const email = store.getUser()?.email;
    if (email) { S.reconnect.delete(email); dropCache(email); }
    if (S.signedIn) go({ quiet: true });
  } catch (err) {
    if (!/popup-closed|cancelled/i.test(err.code || "")) toast(err.message);
  }
}

async function reconnect(email, btn) {
  if (btn) btn.disabled = true;
  try {
    const owner = store.getUser()?.email?.toLowerCase() === email.toLowerCase();
    if (S.gis) await google.reconnect(email);
    else if (owner) await store.signIn();
    else throw new Error("Add googleClientId to js/config.js to reconnect extra accounts.");
    S.reconnect.delete(email);
    dropCache(email);
    await go({ quiet: true });
  } catch (err) {
    toast(err.message);
  } finally { if (btn) btn.disabled = false; }
}

async function addAccount() {
  if (!S.gis) { toast("Add googleClientId to js/config.js to link more Google accounts."); return; }
  try {
    const acct = await google.linkAccount();
    await store.update((p) => {
      if (!p.accounts.some((a) => a.email.toLowerCase() === acct.email.toLowerCase())) p.accounts.push(acct);
    });
    dropCache(acct.email);
    closePop();
    toast(`Added ${acct.email}`);
    go({ quiet: true });
  } catch (err) { toast(err.message); }
}

async function removeAccount(email) {
  await store.update((p) => {
    p.accounts = p.accounts.filter((a) => a.email !== email);
    p.hidden = p.hidden.filter((k) => !k.startsWith(`${email}|`));
  }).catch((err) => toast(err.message));
  google.tokens.clear(email);
  S.reconnect.delete(email);
  dropCache(email);
  S.calendars.delete(email);
  openPop();
  go({ quiet: true });
}

function dropCache(email) {
  for (const k of [...S.cache.keys()]) if (!email || k.startsWith(`${email}|`)) S.cache.delete(k);
}

async function toggleCalendar(key, on) {
  await store.update((p) => {
    p.hidden = p.hidden.filter((k) => k !== key);
    if (!on) p.hidden.push(key);
  }).catch((err) => toast(err.message));
  render(false);
}

// ---------------- accounts popover ----------------
const pop = $("#acctPop");

function openPop() {
  const prof = store.getProfile();
  const kids = [];
  if (S.signedIn) {
    for (const group of calendarsList()) {
      const acct = prof.accounts.find((a) => a.email === group.account) || { email: group.account };
      const owner = store.getUser()?.email === acct.email;
      const needs = S.reconnect.has(acct.email);
      kids.push(h("section", { class: "pa" },
        h("div", { class: "pa-head" }, avatar(acct),
          h("span", { class: "pa-who" }, h("strong", { text: acct.name || acct.email }), h("span", { class: "sub", text: acct.email })),
          needs ? h("button", { class: "btn small", type: "button", text: "Reconnect", onclick: (e) => reconnect(acct.email, e.currentTarget) })
            : owner ? h("span", { class: "pa-tag", text: "Main" })
              : h("button", { class: "link-btn", type: "button", text: "Remove", onclick: () => removeAccount(acct.email) })),
        calList(group.cals)));
    }
    kids.push(h("button", { class: "pa-add", type: "button", onclick: addAccount }, h("span", { class: "plus", text: "+" }), "Add another Google account"));
  } else {
    kids.push(h("section", { class: "pa" }, h("p", { class: "pa-note", text: "Sample calendars" }), calList(sampleCalendars)));
    if (store.configured) kids.push(h("button", { class: "btn primary wide", type: "button", onclick: signIn }, googleMark(), "Sign in with Google"));
  }

  if (prof.rules.keywords.length) {
    kids.push(h("section", { class: "pa kw" },
      h("p", { class: "pa-note", text: "Keyword photos" }),
      ...prof.rules.keywords.map((k) => h("div", { class: "kw-row" },
        h("span", { class: "kw-word", text: `“${k.word}”` }),
        h("button", { class: "link-btn", type: "button", text: "Remove", onclick: async () => { await removeKeyword(k.word).catch((e) => toast(e.message)); render(false); openPop(); } })))));
  }
  if (S.signedIn) kids.push(h("button", { class: "link-btn muted pa-out", type: "button", text: "Sign out", onclick: async () => { closePop(); await store.signOut(); } }));

  pop.replaceChildren(...kids);
  pop.hidden = false;
  $("#acctBtn").setAttribute("aria-expanded", "true");
}

function calList(cals) {
  const hidden = store.getProfile().hidden;
  if (!cals.length) return h("p", { class: "sub pa-empty", text: "Calendars appear after they load." });
  return h("ul", { class: "cal-list" }, cals.map((c) => {
    const id = `cal-${c.key.replace(/[^a-z0-9]/gi, "")}`.slice(0, 60);
    const input = h("input", { type: "checkbox", id, checked: !hidden.includes(c.key) });
    input.addEventListener("change", () => toggleCalendar(c.key, input.checked));
    return h("li", {}, h("label", { class: "cal", for: id, vars: { "--c": c.color } }, input, h("span", { class: "cal-box" }), h("span", { class: "cal-name", text: c.name })));
  }));
}

function closePop() {
  pop.hidden = true;
  $("#acctBtn").setAttribute("aria-expanded", "false");
}

// ---------------- toast ----------------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove("out");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.add("out"); setTimeout(() => (t.hidden = true), 300); }, 4200);
}

// ---------------- wiring ----------------
function wire() {
  $("#prevBtn").addEventListener("click", () => nav(-1));
  $("#nextBtn").addEventListener("click", () => nav(1));
  $("#todayBtn").addEventListener("click", goToday);
  for (const b of document.querySelectorAll("#seg [data-v]")) b.addEventListener("click", () => setView(b.dataset.v));
  $("#acctBtn").addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? openPop() : closePop(); });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) closePop(); });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest("input, textarea, [contenteditable]")) return;
    const k = e.key.toLowerCase();
    if (k === "escape" && !pop.hidden) { closePop(); return; }
    if (panelEvent()) return;
    if (k === "arrowleft" || k === "j") nav(-1);
    else if (k === "arrowright" || k === "k") nav(1);
    else if (k === "t") goToday();
    else if (k === "d") setView("day");
    else if (k === "w") setView("week");
    else if (k === "m") setView("month");
    else return;
    e.preventDefault();
  });

  // Horizontal swipe to move between days, weeks or months.
  let sx = 0, sy = 0, tracking = false;
  stage.addEventListener("touchstart", (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; tracking = e.touches.length === 1; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) nav(dx < 0 ? 1 : -1);
  }, { passive: true });

  mobile.addEventListener("change", () => go({ quiet: true }));
  setInterval(() => { updateNow(stage); renderHeader(); }, 30000);
  setInterval(() => { if (!document.hidden && S.signedIn) { dropCache(); go({ quiet: true }); } }, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) updateNow(stage); });

  setupPanel({
    signedIn: () => S.signedIn,
    changed: () => { resetMemo(); render(false); },
  });

  store.onProfile(() => {
    if (!S.signedIn) return;
    renderAvatars();
    if (!pop.hidden) openPop();
  });
}

// #day, #week or #month in the address opens that view (handy for bookmarks).
const hashView = () => ["day", "week", "month"].find((v) => location.hash === `#${v}`);

async function boot() {
  if (hashView()) S.view = hashView();
  addEventListener("hashchange", () => hashView() && setView(hashView()));
  wire();
  renderWelcome();
  go({ quiet: true });
  google.initGis(googleClientId).then((ok) => (S.gis = ok));
  let firstUser = true;
  await store.init((user, err) => {
    const was = S.signedIn;
    S.signedIn = !!user;
    if (err) toast("Couldn't read your saved settings from Firestore. Check the security rules in README.");
    if (user) {
      for (const a of store.getProfile().accounts) if (!google.tokens.get(a.email)) S.reconnect.add(a.email);
    } else {
      S.reconnect.clear(); S.calendars.clear(); dropCache();
    }
    resetMemo();
    closePanel();
    if (was !== S.signedIn || firstUser) go(firstUser ? { quiet: true } : { kind: "fade" });
    firstUser = false;
  }).catch((err) => { console.error(err); toast("Firebase didn't load. Check js/config.js."); });
}

boot();
