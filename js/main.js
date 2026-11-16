// App shell: header, navigation, data loading, accounts.
import { h, $, startOfDay, addDays, addMonths, startOfWeek, sameDay, fmt, loadJSON, saveJSON, ended } from "./util.js";
import { renderList, stackRuns } from "./views.js";
import { setupPanel, openPanel, closePanel, refreshPanel, panelEvent, icon } from "./panel.js";
import * as store from "./store.js";
import * as google from "./google.js";
import { googleClientId, tokenWorkerUrl } from "./config.js";
import { sampleEvents, sampleCalendars } from "./sample.js";
import { resetMemo, removeKeyword } from "./photos.js";
import { isDone, setDone } from "./done.js";
import { setupGestures } from "./gestures.js";



const S = {
  view: ["day", "week", "month"].includes(loadJSON("bd:view", null)) ? loadJSON("bd:view", null) : "week",
  anchor: startOfDay(new Date()),
  events: [],
  calendars: new Map(),       // account email -> calendar list
  reconnect: new Set(),       // account emails whose token expired
  signedIn: false,
  gis: false,
  cache: new Map(),           // `${email}|${start}|${end}` -> {t, events}
  seq: 0,
  target: null,             // where navigation is heading (set before data loads)
  shownSignedIn: null,      // whose events are on screen: scroll is kept only for the same ones
  // Accounts from the last session, shown while Firebase restores it, so a
  // signed-in user never sees the sample calendar flash first.
  pending: null,
  // "plan": what's still to do. "done": only what you marked as completed, same range.
  tab: "plan",
  // Signed out, the calendar starts empty. "Try the demo" fills it with
  // sample events until sign-in or "Exit demo" (kept for the browser tab).
  demo: (() => { try { return sessionStorage.getItem("bd:demo") === "1"; } catch { return false; } })(),
};
S.target = { view: S.view, anchor: S.anchor };

const stage = $("#stage");

// ---------------- ranges ----------------
function rangeOf(view, anchor) {
  if (view === "month") {
    const s = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    return { start: s, end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1) };
  }
  if (view === "day") return { start: anchor, end: addDays(anchor, 1) };
  const s = startOfWeek(anchor);
  return { start: s, end: addDays(s, 7) };
}
function shift(view, anchor, dir) {
  if (view === "month") return addMonths(anchor, dir);
  if (view === "day") return addDays(anchor, dir);
  return addDays(anchor, dir * 7);
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

// ?mock in the address: fake signed-in state with two accounts, for UI testing.
const MOCK = new URLSearchParams(location.search).has("mock");

async function eventsFor(start, end) {
  if (!S.signedIn) return S.demo ? sampleEvents(start, end) : [];
  if (MOCK) return sampleEvents(start, end);
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
  if (!S.signedIn) return S.demo ? [{ account: "Sample calendars", cals: sampleCalendars }] : [];
  if (MOCK) return store.getProfile().accounts.map((a, i) => ({ account: a.email, cals: i === 0 ? sampleCalendars.slice(1) : i === 1 ? sampleCalendars.slice(0, 1) : [] }));
  return store.getProfile().accounts.map((a) => ({ account: a.email, cals: S.calendars.get(a.email) || [] }));
}

// ---------------- navigation ----------------
async function go({ view = S.target.view, anchor = S.target.anchor, kind = null, quiet = false } = {}) {
  const seq = ++S.seq;
  S.target = { view, anchor };
  if (S.pending) { S.view = view; S.anchor = anchor; renderHeader(); return; }
  const { start, end } = rangeOf(view, anchor);
  const slow = setTimeout(() => document.body.classList.add("loading"), 180);
  const events = await eventsFor(start, end);
  clearTimeout(slow);
  if (seq !== S.seq) return;
  document.body.classList.remove("loading");
  const sameRange = view === S.view && +rangeOf(view, anchor).start === +rangeOf(S.view, S.anchor).start && S.shownSignedIn === S.signedIn;
  S.view = view; S.anchor = anchor; S.events = events;
  saveJSON("bd:view", view);
  // 6: the address follows the view, so #week etc. are always bookmarkable
  if (location.hash !== `#${view}`) history.replaceState(null, "", `${location.pathname}${location.search}#${view}`);
  render(sameRange);
  S.shownSignedIn = S.signedIn;
  if (kind && !quiet) animateIn(kind);
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

const nav = (dir) => go({ anchor: shift(S.target.view, S.target.anchor, dir), kind: dir > 0 ? "next" : "prev" });
const goToday = () => {
  const today = startOfDay(new Date());
  const { start, end } = rangeOf(S.view, S.anchor);
  const inRange = today >= start && today < end;
  if (inRange && S.view !== "day") { scrollToToday(true); return; }
  go({ anchor: today, kind: today < start ? "prev" : today >= end ? "next" : null });
};
const setView = (view, anchor = S.target.anchor) => {
  const from = S.target.view;
  if (view === from && sameDay(anchor, S.target.anchor)) return;
  // Swapped in place, no fade: the same cards stay put across views, and fading
  // the new list in from transparent shows the bare page behind it as a flash.
  go({ view, anchor, kind: "swap" });
};

// ---------------- rendering ----------------
// keepScroll: re-render in place (data refresh, filters). Otherwise a new range
// starts at today when it is in view, or at the top.
function render(keepScroll) {
  const prevScroll = stage.scrollTop;
  const done = S.tab === "done";
  const events = S.events.filter((e) => visible(e) && isDone(e) === done);
  const ctx = { openEvent: (e) => openPanel(e), openDay: (d) => setView("day", startOfDay(d)), done: isDone, completed: done, leaveTab: () => setTab("plan") };
  if (!S.signedIn && !S.demo) ctx.empty = { title: "Your calendar goes here", text: store.configured ? "Sign in with Google to see your events, or try the demo." : "Connect Firebase to see your events, or try the demo." };
  const { start, end } = rangeOf(S.view, S.anchor);
  const days = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  stage.replaceChildren(renderList(days, events, ctx, S.view));
  stage.dataset.view = S.view;
  stage.dataset.tab = S.tab;
  if (keepScroll) stage.scrollTop = prevScroll;
  else scrollToToday(false);
  renderHeader();
}

// Slide/fade the new list and title in. No overlay, so clicks keep working mid-animation.
function animateIn(kind) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (kind !== "swap") stage.firstElementChild?.classList.add(`enter-${kind}`);
  const title = $("#title");
  if (!S.titleChanged) return; // the same words again: animating them only looks like a flicker
  title.classList.remove("enter");
  void title.offsetWidth;
  title.classList.add("enter");
}

function scrollToToday(smooth) {
  const today = $(".day.today", stage);
  if (!today || S.view === "day") { stage.scrollTo({ top: 0, behavior: smooth ? "smooth" : "instant" }); return; }
  const top = today.offsetTop - 8;
  stage.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "instant" });
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
  S.titleChanged = title.textContent !== `${month} ${year}`;
  if (S.titleChanged) title.replaceChildren(h("span", { class: "t-month", text: month }), " ", h("span", { class: "t-year", text: year }));
  $("#seg").dataset.view = S.view;
  for (const b of document.querySelectorAll("#seg [data-v]")) b.setAttribute("aria-pressed", String(b.dataset.v === S.view));
  const today = startOfDay(new Date());
  $("#todayBtn").disabled = S.view === "day" && sameDay(S.anchor, today);
  renderDoneBtn();
  renderAvatars();
}

// The Completed tab's button: a check, with how many in this range are done.
function renderDoneBtn() {
  const btn = $("#doneBtn");
  const n = S.events.filter((e) => visible(e) && isDone(e)).length;
  const on = S.tab === "done";
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", n ? `Completed (${n})` : "Completed");
  btn.title = on ? "Back to your plans (C)" : "Completed (C)";
  const badge = $(".db-n", btn);
  badge.textContent = n > 99 ? "99+" : String(n);
  badge.hidden = !n || on;
}

function setTab(tab) {
  if (S.tab === tab) return;
  S.tab = tab;
  closePanel();
  render(false);
  if (!reduceMotion()) stage.firstElementChild?.classList.add("enter-fade");
}

// Mark an event done or not done, with Undo in the toast. Its card fades and folds
// away, then the list glides into its new places (see renderSmooth); a returning
// card fades in. delay: let the panel slide out first, so the card is seen leaving.
async function toggleDone(ev, on = !isDone(ev), { delay = 0, quiet = false } = {}) {
  const saved = setDone(ev, on);
  saved.catch((err) => toast(err.message));
  if (delay && !reduceMotion()) await new Promise((r) => setTimeout(r, delay));
  await leave(ev);
  renderSmooth();
  if (quiet) return;
  toast(on ? `Done: ${ev.title}` : `Not done: ${ev.title}`, { label: "Undo", run: () => toggleDone(ev, !on, { quiet: true }) });
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

// Fold the event's row closed (or its whole day, if it was the day's only event).
// Rows below follow as the space closes, instead of jumping when the list re-renders.
async function leave(ev) {
  const card = stage.querySelector(`.card[data-id="${CSS.escape(ev.id)}"]`);
  if (!card || reduceMotion()) return;
  let row = card.closest(".cards > li");
  const day = row.closest(".day");
  // Today keeps its section on the plan list (with "Nothing planned today"), so only its row goes.
  const lastOfDay = day && day.querySelectorAll(".card[data-id]").length === 1 && (S.tab === "done" || !day.classList.contains("today"));
  if (lastOfDay) row = day;
  const cs = getComputedStyle(row);
  const gap = row === day ? 0 : parseFloat(getComputedStyle(row.parentElement).rowGap) || 0;
  row.style.overflow = "hidden";
  // A swiped card has already flown off; only its row is left to fold.
  if (row === day || !row.classList.contains("sw-on")) (row === day ? row : card).animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.96)" }], { duration: 180, easing: EASE, fill: "forwards" });
  await ended(row.animate([
    { height: `${row.offsetHeight}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, borderTopWidth: cs.borderTopWidth, marginBottom: cs.marginBottom },
    { height: "0px", paddingTop: "0px", paddingBottom: "0px", borderTopWidth: "0px", marginBottom: `${-gap}px` },
  ], { duration: 280, delay: 80, easing: EASE, fill: "forwards" }));
}

// Re-render in place and animate what moved from where it was (FLIP), so nothing
// jumps: rows are matched by event id, markers and headers by their day.
function flipKey(el) {
  const day = el.closest(".day")?.dataset.day || "";
  if (el.classList.contains("day-h")) return `h|${day}`;
  if (el.classList.contains("free-run")) return `f|${el.textContent}`;
  const id = el.querySelector(":scope > .card")?.dataset.id;
  return id ? `e|${id}` : `m|${day}|${el.classList[0]}|${el.classList[1] || ""}`;
}
const FLIP = ".day-h, .free-run, .cards > li";
function renderSmooth() {
  if (reduceMotion()) { render(true); return; }
  const before = new Map();
  for (const el of stage.querySelectorAll(FLIP)) before.set(flipKey(el), el.getBoundingClientRect().top);
  render(true);
  const root = stage.firstElementChild;
  if (root) stackRuns(root); // tucked cards take their place now, not after the next frame
  for (const el of stage.querySelectorAll(FLIP)) {
    const was = before.get(flipKey(el));
    if (was === undefined) {
      if (before.size) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, delay: 120, easing: EASE, fill: "backwards" });
      continue;
    }
    const dy = was - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 0.5) el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 320, easing: EASE });
  }
}

function renderAvatars() {
  const btn = $("#acctBtn");
  const accts = S.pending || (S.signedIn ? store.getProfile().accounts : []);
  btn.replaceChildren();
  if (!accts.length) { btn.append(h("span", { class: "av blank" }, icon("people"))); btn.setAttribute("aria-label", "Accounts"); return; }
  accts.slice(0, 2).forEach((a, i) => btn.append(avatar(a, i)));
  if (accts.length > 2) btn.append(h("span", { class: "av more", text: `+${accts.length - 2}` }));
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
  card.hidden = S.signedIn || !!S.pending || dismissed;
  if (card.hidden) return;
  const close = h("button", { class: "icon-btn wc-x", type: "button", "aria-label": "Hide", onclick: () => {
    try { sessionStorage.setItem("bd:welcome", "0"); } catch {}
    card.hidden = true;
  } }, icon("close"));
  card.replaceChildren(...[
    h("div", { class: "wc-text" },
      // The app name must be visible here: Google's consent-screen review checks the home page for it.
      h("strong", {}, h("span", { class: "wc-long", text: "Better Calendar: a picture for every plan." }), h("span", { class: "wc-short", text: "Better Calendar" })),
      h("span", {}, (S.demo ? "These are sample events. " : "Your Google Calendar with a photo for every event. ")
        + (store.configured ? "Sign in to see yours, from as many Google accounts as you like. " : "Add your Firebase settings to js/config.js to connect your calendars (see README). "),
        h("a", { class: "wc-link", href: "privacy.html", text: "Privacy" }))),
    h("button", { class: "btn wc-demo", type: "button", text: S.demo ? "Exit demo" : "Try the demo", onclick: () => setDemo(!S.demo) }),
    store.configured ? h("button", { class: "btn primary", type: "button", onclick: signIn }, googleMark(), "Sign in with Google") : null,
    close,
  ].filter(Boolean));
}

function setDemo(on) {
  S.demo = on;
  try { on ? sessionStorage.setItem("bd:demo", "1") : sessionStorage.removeItem("bd:demo"); } catch {}
  closePanel();
  resetMemo();
  if (!pop.hidden) openPop();
  go({ kind: "fade" });
}

function googleMark() {
  const t = document.createElement("template");
  t.innerHTML = '<svg class="g" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';
  return t.content.firstChild;
}

// ---------------- accounts ----------------
async function signOut() {
  closePop();
  if (MOCK) { S.signedIn = false; S.reconnect.clear(); store.useMock(null); resetMemo(); go({ kind: "fade" }); renderAvatars(); return; }
  await store.signOut();
}

// One popup. With the token Worker, that same popup also connects the account
// for background token refreshes; without it, Firebase's own popup is used.
async function signIn() {
  try {
    if (S.gis && google.workerUp()) {
      const acct = await google.connect({ signedIn: false });
      await store.signInWithGoogleToken(acct.googleIdToken);
    } else {
      await store.signIn();
    }
    const email = store.getUser()?.email;
    if (email) { S.reconnect.delete(email); dropCache(email); }
    if (S.signedIn) go({ quiet: true });
  } catch (err) {
    if (!/popup-closed|cancelled/i.test(err.code || "")) toast(err.message);
  }
}

async function reconnect(email, btn) {
  if (btn) btn.disabled = true;
  if (MOCK) { S.reconnect.delete(email); renderBanner(); renderAvatars(); if (!pop.hidden) openPop(); return; }
  try {
    const owner = store.getUser()?.email?.toLowerCase() === email.toLowerCase();
    if (S.gis && google.workerUp()) await google.connect({ email, signedIn: true });
    else if (S.gis) await google.reconnect(email);
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
  if (MOCK) {
    const n = store.getProfile().accounts.length + 1;
    const acct = { email: `extra${n}@example.com`, name: `Extra account ${n}`, picture: "" };
    await store.update((p) => { p.accounts.push(acct); });
    closePop(); toast(`Added ${acct.email}`); return;
  }
  if (!S.gis) { toast("Add googleClientId to js/config.js to link more Google accounts."); return; }
  try {
    const acct = google.workerUp() ? await google.connect({ signedIn: true }) : await google.linkAccount();
    await store.update((p) => {
      if (!p.accounts.some((a) => a.email.toLowerCase() === acct.email.toLowerCase())) p.accounts.push({ email: acct.email, name: acct.name, picture: acct.picture });
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
  google.disconnect(email);
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
  render(true);
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
    if (S.demo) kids.push(h("section", { class: "pa" }, h("p", { class: "pa-note", text: "Sample calendars" }), calList(sampleCalendars)));
    kids.push(h("button", { class: "btn wide pa-demo", type: "button", text: S.demo ? "Exit demo" : "Try the demo", onclick: () => setDemo(!S.demo) }));
    if (store.configured) kids.push(h("button", { class: "btn primary wide", type: "button", onclick: signIn }, googleMark(), "Sign in with Google"));
  }

  const autoToggle = h("input", { type: "checkbox", id: "autoPhotos", role: "switch", checked: prof.autoPhotos !== false });
  autoToggle.addEventListener("change", async () => {
    await store.update((p) => { p.autoPhotos = autoToggle.checked; }).catch((e) => toast(e.message));
    resetMemo();
    render(true);
  });
  kids.push(h("section", { class: "pa" },
    h("label", { class: "sw-row", for: "autoPhotos" },
      h("span", { class: "sw-txt" },
        h("strong", { text: "Automatic photos" }),
        h("span", { class: "sub", text: "For events whose title clearly says what they are, like gym, flight, dinner or birthday. Other events stay plain until you pick a photo." })),
      autoToggle, h("span", { class: "sw", "aria-hidden": "true" }))));

  if (prof.rules.keywords.length) {
    kids.push(h("section", { class: "pa kw" },
      h("p", { class: "pa-note", text: "Keyword photos" }),
      ...prof.rules.keywords.map((k) => h("div", { class: "kw-row" },
        h("span", { class: "kw-word", text: `“${k.word}”` }),
        h("button", { class: "link-btn", type: "button", text: "Remove", onclick: async () => { await removeKeyword(k.word).catch((e) => toast(e.message)); render(true); openPop(); } })))));
  }
  kids.push(h("div", { class: "pa-foot" },
    S.signedIn ? h("button", { class: "link-btn muted", type: "button", text: "Sign out", onclick: signOut }) : h("span"),
    h("a", { class: "link-btn muted", href: "privacy.html", text: "Privacy" })));

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
// action: { label, run } adds a button (Undo), and keeps the toast up a little longer.
function toast(msg, action = null) {
  const t = $("#toast");
  t.replaceChildren(h("span", { class: "toast-txt", text: msg }));
  if (action) t.append(h("button", { class: "toast-btn", type: "button", text: action.label, onclick: () => { hide(); action.run(); } }));
  const hide = () => { clearTimeout(toastTimer); t.classList.add("out"); setTimeout(() => { if (t.classList.contains("out")) t.hidden = true; }, 300); };
  t.hidden = false;
  t.classList.remove("out");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 6000 : 4200);
}

// ---------------- wiring ----------------
function wire() {
  $("#prevBtn").addEventListener("click", () => nav(-1));
  $("#nextBtn").addEventListener("click", () => nav(1));
  $("#todayBtn").addEventListener("click", goToday);
  $("#doneBtn").addEventListener("click", () => setTab(S.tab === "done" ? "plan" : "done"));
  for (const b of document.querySelectorAll("#seg [data-v]")) b.addEventListener("click", () => setView(b.dataset.v));
  $("#acctBtn").addEventListener("click", (e) => { e.stopPropagation(); pop.hidden ? openPop() : closePop(); });
  document.addEventListener("click", (e) => {
    if (pop.hidden) return;
    const path = e.composedPath();
    if (path.includes(pop) || path.includes($("#acctBtn"))) return;
    closePop();
    e.stopPropagation();
    e.preventDefault();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape" && !pop.hidden) { closePop(); $("#acctBtn").focus(); e.stopImmediatePropagation(); return; }
    if (e.target.closest("input, textarea, [contenteditable]")) return;
    const k = e.key.toLowerCase();
    if (panelEvent()) return;
    const focused = e.target.closest?.(".card[data-id]");
    if (k === "x" && focused) {
      const ev = S.events.find((x) => x.id === focused.dataset.id);
      if (ev) toggleDone(ev);
    } else if (k === "c") setTab(S.tab === "done" ? "plan" : "done");
    else if (k === "arrowleft" || k === "j") nav(-1);
    else if (k === "arrowright" || k === "k") nav(1);
    else if (k === "t") goToday();
    else if (k === "d") setView("day");
    else if (k === "w") setView("week");
    else if (k === "m") setView("month");
    else return;
    e.preventDefault();
  });

  // Swipe a card (touch, mouse or trackpad) to mark it done; swipe elsewhere to move between days, weeks or months.
  setupGestures(stage, {
    nav,
    swiped: (id) => {
      const ev = S.events.find((x) => x.id === id);
      if (ev) toggleDone(ev); else render(true);
    },
  });

  // Keep "now" markers and past events current.
  // Not while a card is being swiped: re-rendering would drop it from under the finger.
  setInterval(() => { if (!document.hidden && !stage.querySelector(".sw-on")) render(true); }, 60000);
  setInterval(() => { if (!document.hidden && S.signedIn) { dropCache(); go({ quiet: true }); } }, 10 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(true); });

  setupPanel({
    signedIn: () => S.signedIn,
    changed: () => { resetMemo(); render(true); },
    isDone,
    toggleDone: (ev) => { closePanel(); toggleDone(ev, undefined, { delay: 200 }); },
  });

  store.onProfile(() => {
    if (!S.signedIn) return;
    rememberSession();
    renderAvatars();
    if (!pop.hidden) openPop();
  });
}

function rememberSession() {
  if (!S.signedIn) { try { localStorage.removeItem("bd:session"); } catch {} return; }
  saveJSON("bd:session", store.getProfile().accounts.map(({ email, name, picture }) => ({ email, name, picture })));
}

// #day, #week or #month in the address opens that view (handy for bookmarks).
const hashView = () => ["day", "week", "month"].find((v) => location.hash === `#${v}`);

async function boot() {
  if (hashView()) S.view = hashView();
  S.target = { view: S.view, anchor: S.anchor };
  addEventListener("hashchange", () => hashView() && setView(hashView()));
  wire();
  const remembered = loadJSON("bd:session", null);
  if (!MOCK && store.configured && Array.isArray(remembered) && remembered.length) {
    S.pending = remembered;
    document.body.classList.add("loading");
  }
  renderWelcome();
  go({ quiet: true });
  if (MOCK) {
    store.useMock({ accounts: [
      { email: "you@example.com", name: "Sample You", picture: "", owner: true },
      { email: "work@example.com", name: "Work Account", picture: "" },
    ] });
    S.signedIn = true;
    S.reconnect.add("work@example.com");
    go({ quiet: true });
    return;
  }
  google.initGis(googleClientId).then((ok) => (S.gis = ok));
  google.useWorker(tokenWorkerUrl, store.idToken);
  let firstUser = true;
  await store.init((user, err) => {
    const was = S.signedIn;
    S.signedIn = !!user;
    if (err) toast("Couldn't read your saved settings from Firestore. Check the security rules in README.");
    if (user) {
      if (S.demo) { S.demo = false; try { sessionStorage.removeItem("bd:demo"); } catch {} }
      // With the Worker, a missing token is fetched when needed; Reconnect shows only if that fails.
      if (!google.workerUp()) for (const a of store.getProfile().accounts) if (!google.tokens.get(a.email)) S.reconnect.add(a.email);
    } else {
      S.reconnect.clear(); S.calendars.clear(); dropCache();
    }
    rememberSession();
    const restoring = !!S.pending;
    S.pending = null;
    resetMemo();
    closePanel();
    if (was !== S.signedIn || firstUser) go(restoring || !firstUser ? { kind: "fade" } : { quiet: true });
    firstUser = false;
  }).catch((err) => {
    console.error(err);
    toast("Firebase didn't load. Check js/config.js.");
    if (S.pending) { S.pending = null; go({ kind: "fade" }); }
  });
}

boot();
