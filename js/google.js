// Google Calendar access for several Google accounts at once.
// Each account has its own access token (about one hour), cached in this
// browser and never in Firestore. With the token Worker (worker/), new ones
// come from it in the background. Without it, or while it is down, they come
// from Google Identity Services and each one needs a click.

import { loadJSON, saveJSON, parseLocalDate } from "./util.js";

export const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SCOPES = `${CAL_SCOPE} openid email profile`;
const API = "https://www.googleapis.com/calendar/v3";

let clientId = null;
let tokenClient = null;
let pending = null;

export function initGis(id) {
  return new Promise((resolve) => {
    if (!id) return resolve(false);
    clientId = id;
    const tick = () => {
      if (!window.google?.accounts?.oauth2) return setTimeout(tick, 120);
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: id,
        scope: SCOPES,
        callback: (r) => pending?.(r),
        error_callback: (e) => pending?.({ error: popupError(e) }),
      });
      resolve(true);
    };
    tick();
  });
}

const popupError = (e) => (e?.type === "popup_closed" ? "The Google window was closed" : (e?.type || "Sign-in failed"));

// ---- token Worker ----
// Quota rule (CLAUDE.md): one Worker request per token, never per Calendar call,
// never in a retry loop. Simple requests (text/plain, no custom headers) skip the
// CORS preflight, which would double the count.

let worker = null;                 // { url, idToken: () => Promise<string|null> }
const DOWN = "bd:workerDown";      // skip the Worker until this time (ms)
const RETRY_DOWN = 15 * 60e3;
const inflight = new Map();        // email -> Promise<token|null>, so a burst makes one call
const unconnected = new Set();     // the Worker has no refresh token for these: don't ask again

export function useWorker(url, idToken) { worker = url ? { url: url.replace(/\/+$/, ""), idToken } : null; }
export const workerUp = () => !!worker && !(Number(loadJSON(DOWN, 0)) > Date.now());

class WorkerDown extends Error {
  constructor() { super("The sign-in service didn't answer. Click again to continue without it."); this.workerDown = true; }
}

const nextUtcMidnight = () => { const d = new Date(); d.setUTCHours(24, 0, 0, 0); return +d; };

async function post(path, body) {
  let r;
  try {
    r = await fetch(`${worker.url}${path}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
  } catch {
    // Cloudflare's own error pages (the free plan's daily limit among them) have no
    // CORS headers, so they land here too. Offline is not the Worker's fault.
    if (navigator.onLine !== false) saveJSON(DOWN, Date.now() + RETRY_DOWN);
    throw new WorkerDown();
  }
  // 429: rate limited. The free plan's daily allowance resets at 00:00 UTC.
  if (r.status === 429) { saveJSON(DOWN, nextUtcMidnight()); throw new WorkerDown(); }
  const data = await r.json().catch(() => null);
  if (!data || r.status >= 500) { saveJSON(DOWN, Date.now() + RETRY_DOWN); throw new WorkerDown(); }
  return { ok: r.ok, data };
}

// A fresh access token from the Worker, or null. Never throws.
function refresh(email) {
  const k = email.toLowerCase();
  if (!workerUp() || unconnected.has(k)) return Promise.resolve(null);
  if (!inflight.has(k)) {
    inflight.set(k, (async () => {
      try {
        const idToken = await worker.idToken();
        if (!idToken) return null;
        const r = await post("/token", { idToken, email: k });
        if (!r.ok) { unconnected.add(k); return null; }
        tokens.set(k, r.data.accessToken, r.data.expiresIn);
        return r.data.accessToken;
      } catch { return null; } finally { inflight.delete(k); }
    })());
  }
  return inflight.get(k);
}

// Google's code popup: always asks for offline access, so a refresh token comes back.
function requestCode({ email } = {}) {
  if (!window.google?.accounts?.oauth2 || !clientId) return Promise.reject(new Error("Google sign-in hasn't loaded yet"));
  return new Promise((resolve, reject) => {
    google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPES,
      ux_mode: "popup",
      ...(email ? { login_hint: email } : { select_account: true }),
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, CAL_SCOPE)) {
          return reject(new Error("Calendar access wasn't allowed. Tick the calendar box on Google's screen."));
        }
        resolve(r.code);
      },
      error_callback: (e) => reject(new Error(popupError(e))),
    }).requestCode();
  });
}

const CONNECT_ERRORS = {
  scope: "Calendar access wasn't allowed. Tick the calendar box on Google's screen.",
  email: "That Google account has no verified email address.",
};

// One popup, then the Worker keeps the account connected. Must run from a click.
// signedIn: whether a Firebase user exists (then the account is linked to it).
// Returns { email, name, picture, googleIdToken, accessToken }.
export async function connect({ email, signedIn }) {
  const code = await requestCode({ email });
  const idToken = signedIn ? await worker.idToken() : undefined;
  // Without it the Worker would treat this as a sign-in and file the account under the wrong user.
  if (signedIn && !idToken) throw new Error("Your sign-in has expired. Reload the page and try again.");
  const r = await post("/connect", { code, idToken });
  if (!r.ok) throw new Error(CONNECT_ERRORS[r.data.error] || "Google sign-in didn't go through. Try again.");
  const acct = r.data;
  if (email && acct.email !== email.toLowerCase()) throw new Error(`Google signed in ${acct.email}. Pick ${email} instead.`);
  unconnected.delete(acct.email);
  tokens.set(acct.email, acct.accessToken, acct.expiresIn);
  return acct;
}

// Forget an account at the Worker (best effort: removing it locally must still work).
export async function disconnect(email) {
  unconnected.delete(email.toLowerCase());
  if (!workerUp()) return;
  const idToken = await worker.idToken().catch(() => null);
  if (idToken) await post("/disconnect", { idToken, email: email.toLowerCase() }).catch(() => {});
}

function requestToken(opts) {
  if (!tokenClient) return Promise.reject(new Error("Google sign-in hasn't loaded yet"));
  return new Promise((resolve, reject) => {
    pending = (r) => {
      pending = null;
      if (r.error) return reject(new Error(r.error_description || r.error));
      if (!google.accounts.oauth2.hasGrantedAllScopes(r, CAL_SCOPE)) {
        return reject(new Error("Calendar access wasn't allowed. Tick the calendar box on Google's screen."));
      }
      resolve(r);
    };
    tokenClient.requestAccessToken(opts);
  });
}

// ---- token cache, one per account email ----
const TK = (email) => `bd:tok:${email.toLowerCase()}`;
export const tokens = {
  get(email) {
    const t = loadJSON(TK(email), null);
    return t && t.e > Date.now() ? t.t : null;
  },
  // Reused until 90 s before it expires, then refreshed (see refresh()).
  set(email, token, expiresIn = 3600) {
    saveJSON(TK(email), { t: token, e: Date.now() + (Number(expiresIn) - 90) * 1000 });
  },
  clear(email) { try { localStorage.removeItem(TK(email)); } catch {} },
};

async function userinfo(token) {
  const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error("Couldn't read the Google account's profile");
  return r.json();
}

// Opens Google's account chooser to link another account.
export async function linkAccount() {
  const r = await requestToken({ prompt: "select_account consent" });
  const info = await userinfo(r.access_token);
  tokens.set(info.email, r.access_token, r.expires_in);
  return { email: info.email, name: info.name || info.email, picture: info.picture || "" };
}

// Gets a fresh token for an account that is already linked. Must run from a click.
export async function reconnect(email) {
  const r = await requestToken({ prompt: "", login_hint: email });
  const info = await userinfo(r.access_token);
  if (info.email.toLowerCase() !== email.toLowerCase()) {
    throw new Error(`Google signed in ${info.email}. Pick ${email} instead.`);
  }
  tokens.set(email, r.access_token, r.expires_in);
}

export class ReauthError extends Error {
  constructor(email) { super(`${email} needs to reconnect`); this.email = email; this.reauth = true; }
}

async function call(email, path, params = {}) {
  const token = tokens.get(email) || await refresh(email);
  if (!token) throw new ReauthError(email);
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) { tokens.clear(email); throw new ReauthError(email); }
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    if (r.status === 403 && /insufficient/i.test(body?.error?.message || "")) { tokens.clear(email); throw new ReauthError(email); }
    throw new Error(body?.error?.message || `Google Calendar returned ${r.status}`);
  }
  return r.json();
}

export async function listCalendars(email) {
  const out = [];
  let pageToken;
  do {
    const r = await call(email, "/users/me/calendarList", pageToken ? { pageToken } : {});
    out.push(...(r.items || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out.map((c) => ({
    key: `${email}|${c.id}`,
    id: c.id,
    account: email,
    name: c.summaryOverride || c.summary || c.id,
    color: c.backgroundColor || "#5b7cfa",
    primary: !!c.primary,
    selectedInGoogle: c.selected !== false,
  })).sort((a, b) => (b.primary - a.primary) || a.name.localeCompare(b.name));
}

// Google's fixed palette for per-event colors.
const EVENT_COLORS = {
  1: "#7986cb", 2: "#33b679", 3: "#8e24aa", 4: "#e67c73", 5: "#f6bf26", 6: "#f4511e",
  7: "#039be5", 8: "#616161", 9: "#3f51b5", 10: "#0b8043", 11: "#d50000",
};

export async function listEvents(cal, timeMin, timeMax) {
  const out = [];
  let pageToken;
  do {
    const params = { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250" };
    if (pageToken) params.pageToken = pageToken;
    const r = await call(cal.account, `/calendars/${encodeURIComponent(cal.id)}/events`, params);
    out.push(...(r.items || []));
    pageToken = r.nextPageToken;
  } while (pageToken);
  return out
    .filter((e) => e.status !== "cancelled")
    .filter((e) => !(e.attendees || []).some((a) => a.self && a.responseStatus === "declined"))
    .map((e) => normalize(e, cal));
}

function normalize(e, cal) {
  const allDay = !!e.start?.date;
  const start = allDay ? parseLocalDate(e.start.date) : new Date(e.start.dateTime);
  const end = allDay ? parseLocalDate(e.end.date) : new Date(e.end.dateTime);
  return {
    id: e.id,
    uid: e.iCalUID || e.id,
    seriesId: e.recurringEventId || null,
    title: e.summary || "(No title)",
    description: e.description || "",
    location: e.location || "",
    start, end, allDay,
    calKey: cal.key, calName: cal.name, account: cal.account,
    color: EVENT_COLORS[e.colorId] || cal.color,
    link: e.htmlLink || null,
    meet: e.hangoutLink || null,
    attendees: (e.attendees || []).filter((a) => !a.resource).length,
  };
}
