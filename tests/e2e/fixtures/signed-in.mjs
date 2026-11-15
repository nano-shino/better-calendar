// A fake signed-in backend for the real (non-?mock) code path: Firebase modules,
// Google Identity Services and the Calendar API, each answering after a delay
// like the real thing. Use with launch({ routes: signedIn().routes }).

const FIREBASE_APP = `export const initializeApp = (c) => ({ c });`;

const FIREBASE_AUTH = `
const user = JSON.parse(localStorage.getItem("fake:user") || "null");
export const getAuth = () => ({});
export function onAuthStateChanged(auth, cb) { setTimeout(() => cb(user), Number(localStorage.getItem("fake:authDelay") || 300)); return () => {}; }
export class GoogleAuthProvider { addScope() {} setCustomParameters() {} static credentialFromResult() { return null; } }
export const signInWithPopup = async () => ({ user });
export const signOut = async () => {};
`;

const FIREBASE_FIRESTORE = `
const delay = () => Number(localStorage.getItem("fake:fsDelay") || 250);
export const initializeFirestore = () => ({});
export const getFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const serverTimestamp = () => 0;
export const doc = (db, ...path) => ({ path: path.join("/") });
export function onSnapshot(ref, cb) {
  const data = JSON.parse(localStorage.getItem("fake:profile") || "null");
  setTimeout(() => cb({ data: () => data, metadata: { fromCache: false } }), delay());
  return () => {};
}
export const setDoc = async () => {};
export const deleteDoc = async () => {};
export const getDoc = (ref) => new Promise((r) => setTimeout(() => r({ exists: () => true, data: () => ({ data: localStorage.getItem("fake:upload") }) }), delay()));
`;

const GSI = `window.google = { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }), hasGrantedAllScopes: () => true } } };`;

// 2x2 PNG as a data URL, standing in for an uploaded photo.
const UPLOAD = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNgYGBgYGBgYGBgYGBgYGAAAAQAAWlmbqsAAAAASUVORK5CYII=";

// Week of Sun 15 – Sat 21 Nov 2026 around the frozen clock (Mon 16, 10:00 UTC).
const at = (d, hm) => `2026-11-${String(d).padStart(2, "0")}T${hm}:00Z`;
const ev = (id, title, d, from, to, extra = {}) => ({
  id, iCalUID: `${id}@google.com`, summary: title, status: "confirmed",
  start: { dateTime: at(d, from) }, end: { dateTime: at(d, to) },
  htmlLink: `https://www.google.com/calendar/event?eid=${id}`, ...extra,
});

export function signedIn({ apiDelay = 500, expired = [] } = {}) {
  const accounts = [
    { email: "me@example.com", name: "Me", picture: "", owner: true },
    { email: "work@example.com", name: "Work", picture: "" },
  ];
  const calendars = {
    "me@example.com": [{ id: "me@example.com", summary: "Personal", backgroundColor: "#4c8bf5", primary: true }],
    "work@example.com": [{ id: "work@example.com", summary: "Work", backgroundColor: "#e67c73", primary: true }],
  };
  const events = {
    "me@example.com": [
      ev("gym16", "Gym", 16, "07:00", "08:00", { recurringEventId: "gym" }),
      ev("gym18", "Gym", 18, "07:00", "08:00", { recurringEventId: "gym" }),
      ev("lunch", "Lunch with Ana", 16, "12:00", "13:00"),
      ev("picked", "Piano lesson", 17, "17:00", "18:00"),
      ev("errand", "Pick up parcel", 19, "09:00", "09:30"),
      ev("dinner", "Dinner with friends", 20, "19:00", "21:00"),
    ],
    "work@example.com": [
      ev("standup16", "Team standup", 16, "09:30", "09:45", { recurringEventId: "standup" }),
      ev("standup17", "Team standup", 17, "09:30", "09:45", { recurringEventId: "standup" }),
      ev("plan", "Quarter planning", 17, "14:00", "16:00"),
      ev("review", "Design review", 19, "11:00", "12:00"),
    ],
  };
  const profile = {
    accounts,
    hidden: [],
    rules: { event: { picked: { type: "upload", id: "u1" } }, series: {}, keywords: [] },
    autoPhotos: true,
  };
  // Runs before the app: a returning user with a remembered session and live tokens.
  const setup = `(() => {
    if (sessionStorage.getItem("fake:init")) return;
    sessionStorage.setItem("fake:init", "1");
    localStorage.setItem("fake:user", ${JSON.stringify(JSON.stringify({ uid: "u", email: "me@example.com", displayName: "Me", photoURL: "" }))});
    localStorage.setItem("fake:profile", ${JSON.stringify(JSON.stringify(profile))});
    localStorage.setItem("fake:upload", ${JSON.stringify(UPLOAD)});
    localStorage.setItem("bd:session", ${JSON.stringify(JSON.stringify(accounts.map(({ email, name, picture }) => ({ email, name, picture }))))});
    for (const e of ${JSON.stringify(accounts.map((a) => a.email).filter((e) => !expired.includes(e)))})
      localStorage.setItem("bd:tok:" + e, JSON.stringify({ t: "tok-" + e, e: Date.now() + 3e6 }));
  })();`;

  const js = (body) => ({ body, type: "text/javascript" });
  const routes = (url, req) => {
    if (url.includes("gstatic.com/firebasejs/")) {
      if (url.endsWith("firebase-app.js")) return js(FIREBASE_APP);
      if (url.endsWith("firebase-auth.js")) return js(FIREBASE_AUTH);
      if (url.endsWith("firebase-firestore.js")) return js(FIREBASE_FIRESTORE);
    }
    if (url.startsWith("https://accounts.google.com/gsi/client")) return js(GSI);
    if (url.startsWith("https://fonts.")) return { body: "", type: "text/css" };
    const m = url.match(/googleapis\.com\/calendar\/v3\/(?:users\/me\/calendarList|calendars\/([^/]+)\/events)/);
    if (m) {
      const auth = req.headers.Authorization || req.headers.authorization || "";
      const account = auth.replace("Bearer tok-", "");
      if (!m[1]) return { body: { items: calendars[account] || [] }, delay: apiDelay };
      const q = new URL(url).searchParams;
      const min = new Date(q.get("timeMin")), max = new Date(q.get("timeMax"));
      const items = (events[decodeURIComponent(m[1])] || []).filter((e) => new Date(e.start.dateTime) < max && new Date(e.end.dateTime) > min);
      return { body: { items }, delay: apiDelay };
    }
    return null;
  };
  return { routes, setup, calendars, events, profile };
}
