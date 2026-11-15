// Google Calendar access for several Google accounts at once.
// Each account gets its own short-lived access token (about one hour) from
// Google Identity Services. Tokens stay in this browser and never go to Firestore.

import { loadJSON, saveJSON, parseLocalDate } from "./util.js";

export const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const SCOPES = `${CAL_SCOPE} openid email profile`;
const API = "https://www.googleapis.com/calendar/v3";

let tokenClient = null;
let pending = null;

export function initGis(clientId) {
  return new Promise((resolve) => {
    if (!clientId) return resolve(false);
    const tick = () => {
      if (!window.google?.accounts?.oauth2) return setTimeout(tick, 120);
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPES,
        callback: (r) => pending?.(r),
        error_callback: (e) => pending?.({ error: e?.type === "popup_closed" ? "The Google window was closed" : (e?.type || "Sign-in failed") }),
      });
      resolve(true);
    };
    tick();
  });
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
  const token = tokens.get(email);
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
