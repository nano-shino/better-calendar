// Token Worker (worker/index.js) against fake Google, Firebase and KV.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import worker, { _reset } from "../../worker/index.js";

const PROJECT = "proj";
const ORIGIN = "https://site.example";
const CAL = "https://www.googleapis.com/auth/calendar.readonly";

// RSA key standing in for Firebase's signing key.
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true, ["sign", "verify"]);
const JWK = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1", alg: "RS256", use: "sig" };

const b64url = (s) => Buffer.from(s).toString("base64url");
async function firebaseToken(uid, over = {}) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", kid: "k1" }));
  const claims = b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: now - 10, exp: now + 3600, ...over }));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${head}.${claims}`)));
  return `${head}.${claims}.${Buffer.from(sig).toString("base64url")}`;
}
const googleIdToken = (email) => `x.${b64url(JSON.stringify({ email, email_verified: true, name: email.split("@")[0] }))}.x`;

let kv, calls, refreshReply, codeScope;
const env = () => ({
  TOKENS: {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
    delete: async (k) => { kv.delete(k); },
  },
  GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", FIREBASE_PROJECT_ID: PROJECT,
  FIREBASE_API_KEY: "key", TOKEN_KEY: Buffer.alloc(32, 7).toString("base64"), ALLOWED_ORIGINS: `${ORIGIN},http://localhost:8000`,
});

const realFetch = globalThis.fetch;
beforeEach(() => {
  _reset();
  kv = new Map(); calls = []; codeScope = `openid email profile ${CAL}`;
  refreshReply = () => ({ status: 200, body: { access_token: `at-${calls.length}`, expires_in: 3599 } });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const form = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : null;
    calls.push({ url: u, form });
    const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
    if (u.includes("/jwk/securetoken")) return json(200, { keys: [JWK] }, { "Cache-Control": "max-age=600" });
    if (u === "https://oauth2.googleapis.com/token" && form.grant_type === "authorization_code") {
      const email = form.code.replace("code-", "");
      return json(200, { access_token: "at-first", expires_in: 3599, refresh_token: `rt-${email}`, scope: codeScope, id_token: googleIdToken(email) });
    }
    if (u === "https://oauth2.googleapis.com/token" && form.grant_type === "refresh_token") {
      const r = refreshReply(form);
      return json(r.status, r.body);
    }
    if (u === "https://oauth2.googleapis.com/revoke") return json(200, {});
    if (u.includes("accounts:signInWithIdp")) return json(200, { localId: "uid-from-idp" });
    throw new Error(`unexpected fetch ${u}`);
  };
});
afterEach(() => { globalThis.fetch = realFetch; });

const post = (path, body, origin = ORIGIN) => worker.fetch(new Request(`https://w.example${path}`, {
  method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: JSON.stringify(body),
}), env());
const google = (grant) => calls.filter((c) => c.form?.grant_type === grant).length;

test("other origins are turned away before any work", async () => {
  const r = await post("/token", { idToken: await firebaseToken("u1"), email: "a@x.com" }, "https://evil.example");
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
});

test("sign-in: stores the refresh token under the Firebase user Google's ID token belongs to", async () => {
  const r = await post("/connect", { code: "code-Me@x.com" });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.email, "me@x.com");
  assert.equal(body.accessToken, "at-first");
  assert.ok(body.googleIdToken, "the browser needs it to sign in to Firebase");
  assert.deepEqual([...kv.keys()], ["rt:uid-from-idp:me@x.com"]);
  assert.ok(!kv.get("rt:uid-from-idp:me@x.com").includes("rt-"), "stored encrypted");
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), ORIGIN);
});

test("linking another account uses the signed-in user, not Google's lookup", async () => {
  const r = await post("/connect", { code: "code-work@x.com", idToken: await firebaseToken("u1") });
  assert.equal(r.status, 200);
  assert.deepEqual([...kv.keys()], ["rt:u1:work@x.com"]);
  assert.ok(!calls.some((c) => c.url.includes("signInWithIdp")));
});

test("connect refuses when calendar access was unticked", async () => {
  codeScope = "openid email profile";
  const r = await post("/connect", { code: "code-me@x.com" });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "scope");
  assert.equal(kv.size, 0);
});

test("/token refreshes once, then answers from memory", async () => {
  const idToken = await firebaseToken("u1");
  await post("/connect", { code: "code-me@x.com", idToken });
  _reset(); // a new isolate: nothing in memory, so it has to use the stored refresh token
  const a = await (await post("/token", { idToken, email: "me@x.com" })).json();
  const b = await (await post("/token", { idToken, email: "ME@x.com" })).json();
  assert.equal(a.accessToken, b.accessToken);
  assert.equal(google("refresh_token"), 1);
  assert.equal(calls.find((c) => c.form?.grant_type === "refresh_token").form.refresh_token, "rt-me@x.com");
});

test("/token needs a valid Firebase token, and only reaches that user's accounts", async () => {
  await post("/connect", { code: "code-me@x.com", idToken: await firebaseToken("u1") });
  for (const bad of ["nope", await firebaseToken("u1", { aud: "other" }), await firebaseToken("u1", { exp: 1 })]) {
    assert.equal((await post("/token", { idToken: bad, email: "me@x.com" })).status, 401);
  }
  const tampered = (await firebaseToken("u1")).replace(/\.[^.]+\./, `.${b64url(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: "u2", iat: 1, exp: 9e9 }))}.`);
  assert.equal((await post("/token", { idToken: tampered, email: "me@x.com" })).status, 401);
  const other = await post("/token", { idToken: await firebaseToken("u2"), email: "me@x.com" });
  assert.equal(other.status, 401);
  assert.equal((await other.json()).error, "reauth");
});

test("a revoked grant is forgotten and reported as reauth", async () => {
  const idToken = await firebaseToken("u1");
  await post("/connect", { code: "code-me@x.com", idToken });
  _reset();
  refreshReply = () => ({ status: 400, body: { error: "invalid_grant" } });
  const r = await post("/token", { idToken, email: "me@x.com" });
  assert.equal(r.status, 401);
  assert.equal((await r.json()).error, "reauth");
  assert.equal(kv.size, 0);
});

test("a Google outage is not mistaken for a revoked grant", async () => {
  const idToken = await firebaseToken("u1");
  await post("/connect", { code: "code-me@x.com", idToken });
  _reset();
  refreshReply = () => ({ status: 503, body: { error: "backendError" } });
  assert.equal((await post("/token", { idToken, email: "me@x.com" })).status, 502);
  assert.equal(kv.size, 1);
});

test("/disconnect revokes at Google and deletes the stored token", async () => {
  const idToken = await firebaseToken("u1");
  await post("/connect", { code: "code-me@x.com", idToken });
  const r = await post("/disconnect", { idToken, email: "me@x.com" });
  assert.equal(r.status, 200);
  assert.equal(kv.size, 0);
  assert.equal(calls.find((c) => c.url.endsWith("/revoke")).form.token, "rt-me@x.com");
  assert.equal((await post("/token", { idToken, email: "me@x.com" })).status, 401);
});

test("a wrong client secret is reported as the Worker's fault, not the user's code", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
  const r = await post("/connect", { code: "code-me@x.com" });
  assert.equal(r.status, 500, "the browser treats 5xx as the Worker being down and falls back");
  assert.equal((await r.json()).error, "client");
});
