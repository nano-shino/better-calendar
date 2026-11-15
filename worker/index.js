// Token Worker (Cloudflare Workers, free plan). Auth only: it keeps each linked
// Google account's refresh token and hands the browser fresh access tokens.
// Calendar data never passes through here.
//
// POST /connect     { code, idToken? }  -> { email, name, picture, accessToken, expiresIn, googleIdToken }
//   Trades a code from Google's popup for tokens and stores the refresh token.
//   With a Firebase idToken it links another account to that user; without one
//   it is a sign-in, and the user is looked up from Google's ID token.
// POST /token       { idToken, email }  -> { accessToken, expiresIn }
// POST /disconnect  { idToken, email }  -> { ok }
//
// Bodies are JSON sent as text/plain with no custom headers, so browsers send a
// "simple" request and skip the CORS preflight: one Worker request per call.
//
// env: TOKENS (KV), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, FIREBASE_PROJECT_ID,
//      FIREBASE_API_KEY, TOKEN_KEY (base64, 32 bytes), ALLOWED_ORIGINS (comma-separated)

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const FIREBASE_JWKS = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Per-isolate memory. Not shared between Cloudflare locations, so it only saves work.
const memo = new Map();        // `${uid}|${email}` -> { accessToken, exp }
let jwks = { keys: null, exp: 0 };

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    // Cheapest check first: anything not from the site is turned away before any work.
    if (!allowed.includes(origin)) return new Response("Forbidden", { status: 403 });
    const reply = (status, body) => new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": origin, Vary: "Origin" },
    });
    if (req.method !== "POST") return reply(405, { error: "method" });

    let body;
    try { body = JSON.parse(await req.text()); } catch { return reply(400, { error: "body" }); }
    const path = new URL(req.url).pathname;
    try {
      if (path === "/connect") return reply(200, await connect(env, body, origin));
      const uid = await verifyFirebase(env, body.idToken);
      if (!uid) return reply(401, { error: "auth" });
      const email = String(body.email || "").toLowerCase();
      if (!email) return reply(400, { error: "email" });
      if (path === "/token") return reply(200, await token(env, uid, email));
      if (path === "/disconnect") return reply(200, await disconnect(env, uid, email));
      return reply(404, { error: "path" });
    } catch (err) {
      if (err.status) return reply(err.status, { error: err.code });
      console.error(err);
      return reply(502, { error: "upstream" });
    }
  },
};

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const kvKey = (uid, email) => `rt:${uid}:${email}`;

async function connect(env, { code, idToken }, origin) {
  if (!code) throw fail(400, "code");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: "postmessage", grant_type: "authorization_code",
    }),
  });
  const t = await r.json().catch(() => ({}));
  // invalid_client: the Worker's own settings are wrong (client id or secret), not the user's code.
  if (t.error === "invalid_client" || t.error === "unauthorized_client") throw fail(500, "client");
  if (!r.ok) throw fail(400, "code");
  if (!String(t.scope || "").split(" ").includes(CAL_SCOPE)) throw fail(400, "scope");
  if (!t.refresh_token) throw fail(400, "offline");
  // Straight from Google's token endpoint over TLS, so no signature check is needed.
  const who = decodeJwt(t.id_token);
  if (!who?.email || !who.email_verified) throw fail(400, "email");
  const email = who.email.toLowerCase();

  const uid = idToken ? await verifyFirebase(env, idToken) : await firebaseUid(env, t.id_token, origin);
  if (!uid) throw fail(401, "auth");
  await env.TOKENS.put(kvKey(uid, email), await seal(env, `${uid}|${email}`, t.refresh_token));
  memo.set(`${uid}|${email}`, { accessToken: t.access_token, exp: Date.now() + (t.expires_in - 300) * 1000 });
  return {
    email, name: who.name || email, picture: who.picture || "",
    accessToken: t.access_token, expiresIn: t.expires_in, googleIdToken: t.id_token,
  };
}

async function token(env, uid, email) {
  const m = memo.get(`${uid}|${email}`);
  if (m && m.exp > Date.now()) return { accessToken: m.accessToken, expiresIn: Math.round((m.exp - Date.now()) / 1000) + 300 };
  const sealed = await env.TOKENS.get(kvKey(uid, email));
  if (!sealed) throw fail(401, "reauth");
  const refresh = await open(env, `${uid}|${email}`, sealed);
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const t = await r.json().catch(() => ({}));
  if (t.error === "invalid_grant") {
    // Revoked, expired, or the password changed: it will never work again.
    await env.TOKENS.delete(kvKey(uid, email));
    throw fail(401, "reauth");
  }
  if (t.error === "invalid_client" || t.error === "unauthorized_client") throw fail(500, "client");
  if (!r.ok) throw fail(502, "upstream");
  memo.set(`${uid}|${email}`, { accessToken: t.access_token, exp: Date.now() + (t.expires_in - 300) * 1000 });
  return { accessToken: t.access_token, expiresIn: t.expires_in };
}

async function disconnect(env, uid, email) {
  const sealed = await env.TOKENS.get(kvKey(uid, email));
  memo.delete(`${uid}|${email}`);
  if (!sealed) return { ok: true };
  const refresh = await open(env, `${uid}|${email}`, sealed).catch(() => null);
  if (refresh) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refresh }),
    }).catch(() => {});
  }
  await env.TOKENS.delete(kvKey(uid, email));
  return { ok: true };
}

// ---- Firebase ----

// The Firebase user for a Google ID token (created on first sign-in, as the
// browser's own sign-in would).
async function firebaseUid(env, googleIdToken, origin) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${env.FIREBASE_API_KEY}`, {
    method: "POST",
    // The web API key may be restricted to the site's referrer.
    headers: { "Content-Type": "application/json", Referer: `${origin}/` },
    body: JSON.stringify({
      postBody: `id_token=${googleIdToken}&providerId=google.com`,
      requestUri: origin, returnSecureToken: true, returnIdpCredential: true,
    }),
  });
  if (!r.ok) return null;
  return (await r.json()).localId || null;
}

async function verifyFirebase(env, idToken) {
  if (typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  const head = decodePart(parts[0]), claims = decodePart(parts[1]);
  if (head?.alg !== "RS256" || !claims) return null;
  const now = Date.now() / 1000;
  if (claims.aud !== env.FIREBASE_PROJECT_ID) return null;
  if (claims.iss !== `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`) return null;
  if (!(claims.exp > now) || !(claims.iat <= now + 60) || !claims.sub) return null;
  const jwk = (await firebaseKeys()).find((k) => k.kid === head.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  return ok ? claims.sub : null;
}

async function firebaseKeys() {
  if (jwks.keys && jwks.exp > Date.now()) return jwks.keys;
  const r = await fetch(FIREBASE_JWKS);
  if (!r.ok) throw fail(502, "upstream");
  const age = Number(/max-age=(\d+)/.exec(r.headers.get("Cache-Control") || "")?.[1] || 3600);
  jwks = { keys: (await r.json()).keys || [], exp: Date.now() + age * 1000 };
  return jwks.keys;
}

// ---- helpers ----

function b64urlBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function decodePart(s) {
  try { return JSON.parse(new TextDecoder().decode(b64urlBytes(s))); } catch { return null; }
}
function decodeJwt(jwt) { return typeof jwt === "string" ? decodePart(jwt.split(".")[1] || "") : null; }
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));

// AES-GCM, bound to the user and account, so a stored value can't be moved to another key.
async function aesKey(env) {
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(env.TOKEN_KEY), (c) => c.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(env, aad, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, await aesKey(env), new TextEncoder().encode(text)));
  return `${b64(iv)}.${b64(ct)}`;
}
async function open(env, aad, sealed) {
  const [iv, ct] = sealed.split(".").map((s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, await aesKey(env), ct);
  return new TextDecoder().decode(pt);
}

// For tests: forget per-isolate memory.
export function _reset() { memo.clear(); jwks = { keys: null, exp: 0 }; }
