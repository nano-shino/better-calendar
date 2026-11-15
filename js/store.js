// Firebase Auth (who you are) + Firestore (your linked accounts, hidden calendars,
// photo choices and uploaded photos). Falls back to an in-memory store for the
// signed-out sample calendar.

import { firebaseConfig } from "./config.js";
import { tokens, CAL_SCOPE } from "./google.js";

const V = "12.18.0";
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

const blankProfile = () => ({ accounts: [], hidden: [], rules: { event: {}, series: {}, keywords: [] }, view: null });

export const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId);

let fb = null;          // loaded Firebase modules
let auth = null, db = null;
let user = null;
let unsubProfile = null;
const profileListeners = new Set();
const photoCache = new Map();
let profile = blankProfile();

export const getProfile = () => profile;
export const getUser = () => user;
export function onProfile(cb) { profileListeners.add(cb); return () => profileListeners.delete(cb); }
const emit = () => profileListeners.forEach((cb) => cb(profile));

function sanitize(p) {
  const b = blankProfile();
  return {
    accounts: Array.isArray(p?.accounts) ? p.accounts : b.accounts,
    hidden: Array.isArray(p?.hidden) ? p.hidden : b.hidden,
    rules: {
      event: p?.rules?.event || {},
      series: p?.rules?.series || {},
      keywords: Array.isArray(p?.rules?.keywords) ? p.rules.keywords : [],
    },
    view: p?.view || null,
  };
}

export async function init(onUser) {
  if (!configured) { onUser(null); return; }
  const [app, authMod, fsMod] = await Promise.all([
    import(`${CDN}/firebase-app.js`),
    import(`${CDN}/firebase-auth.js`),
    import(`${CDN}/firebase-firestore.js`),
  ]);
  fb = { ...authMod, ...fsMod };
  const fbApp = app.initializeApp(firebaseConfig);
  auth = authMod.getAuth(fbApp);
  try {
    db = fsMod.initializeFirestore(fbApp, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch {
    db = fsMod.getFirestore(fbApp);
  }
  authMod.onAuthStateChanged(auth, (u) => {
    user = u;
    unsubProfile?.();
    unsubProfile = null;
    photoCache.clear();
    if (!u) { profile = blankProfile(); emit(); onUser(null); return; }
    let first = true;
    unsubProfile = fsMod.onSnapshot(fsMod.doc(db, "users", u.uid), (snap) => {
      profile = sanitize(snap.data());
      // The signed-in account is always linked.
      if (!profile.accounts.some((a) => a.email.toLowerCase() === u.email.toLowerCase())) {
        profile.accounts.unshift({ email: u.email, name: u.displayName || u.email, picture: u.photoURL || "", owner: true });
        if (!snap.metadata.fromCache) persist();
      }
      emit();
      if (first) { first = false; onUser(u); }
    }, (err) => {
      console.error(err);
      if (first) { first = false; onUser(u, err); }
    });
  });
}

export async function signIn() {
  if (!auth) throw new Error("Firebase isn't set up yet. Add your config to js/config.js.");
  const provider = new fb.GoogleAuthProvider();
  provider.addScope(CAL_SCOPE);
  provider.setCustomParameters({ prompt: "select_account" });
  const result = await fb.signInWithPopup(auth, provider);
  const cred = fb.GoogleAuthProvider.credentialFromResult(result);
  if (cred?.accessToken) tokens.set(result.user.email, cred.accessToken, 3600);
}

export async function signOut() {
  for (const a of profile.accounts) tokens.clear(a.email);
  await fb?.signOut(auth);
}

async function persist() {
  if (!user || !db) return;
  await fb.setDoc(fb.doc(db, "users", user.uid), { ...profile, updatedAt: fb.serverTimestamp() });
}

// Change the profile with a function, then save the whole document.
export async function update(mutate) {
  mutate(profile);
  emit();
  try { await persist(); } catch (err) { console.error("Save failed", err); throw new Error("Couldn't save to Firebase. Check your connection and Firestore rules."); }
}

// ---- uploaded photos (stored as compressed JPEG data URLs, one per document) ----
export async function putPhoto(dataUrl) {
  const id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
  photoCache.set(id, dataUrl);
  if (user && db) {
    await fb.setDoc(fb.doc(db, "users", user.uid, "photos", id), { data: dataUrl, createdAt: fb.serverTimestamp() });
  }
  return id;
}

export async function getPhoto(id) {
  if (photoCache.has(id)) return photoCache.get(id);
  if (!user || !db) return null;
  const p = fb.getDoc(fb.doc(db, "users", user.uid, "photos", id))
    .then((s) => (s.exists() ? s.data().data : null))
    .catch(() => null);
  photoCache.set(id, p);
  const v = await p;
  photoCache.set(id, v);
  return v;
}

export async function deletePhoto(id) {
  photoCache.delete(id);
  if (user && db) await fb.deleteDoc(fb.doc(db, "users", user.uid, "photos", id)).catch(() => {});
}
