// Headless Chrome driven over the DevTools Protocol, with no npm dependencies.
//
// Every page gets:
//  - a fixed clock: Monday 2026-11-16 10:00 in UTC (sample events are
//    generated relative to "today", so results are deterministic),
//  - locale en-US (weeks start on Sunday),
//  - stubbed network for photos: Openverse API calls return tests/e2e/fixtures/openverse.json
//    and every remote image is a tiny PNG, so tests are fast and never flaky.
//    Set REAL_IMAGES=1 to load the real photos (for screenshots you want to look at).
//
// Input goes through real mouse / keyboard / touch events (Input.dispatch*),
// which catches overlay and hit-testing bugs that element.click() would hide.

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const FIXED_NOW = "2026-11-16T10:00:00";
export const TIMEZONE = "UTC";
export const ARTIFACTS = new URL("../.artifacts/", import.meta.url);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// REAL_IMAGES=1 lets photos load from the network (for screenshots you want to look at).
const REAL_IMAGES = !!process.env.REAL_IMAGES;
const FIXTURE = readFileSync(new URL("./fixtures/openverse.json", import.meta.url), "utf8");
// 4x3 grey-blue PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOIyuuBIwacHAA0pg/xmjATKQAAAABJRU5ErkJggg==", "base64");

export function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.");
  return found;
}

const KEYS = { ArrowLeft: 37, ArrowRight: 39, ArrowUp: 38, ArrowDown: 40, Escape: 27, Enter: 13, " ": 32, Tab: 9 };

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  tablet: { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};

export async function launch({ viewport = "desktop", now = FIXED_NOW } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "bc-e2e-"));
  const proc = spawn(chromePath(), [
    "--headless=new", "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--lang=en-US", `--user-data-dir=${profile}`,
    // CI containers (Ubuntu 24.04 runners) block the user namespaces Chrome's sandbox needs.
    ...(process.env.CI ? ["--no-sandbox"] : []),
    "about:blank",
  ], { stdio: "ignore" });

  // Chrome writes the port it picked to DevToolsActivePort.
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0].trim(); } catch {}
  }
  if (!port) throw new Error("Chrome did not start");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener("open", r); ws.addEventListener("error", j); });

  let seq = 0;
  const pending = new Map();
  const errors = [];
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const id = ++seq;
    pending.set(id, { ok, fail, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener("message", async (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      const p = pending.get(d.id); pending.delete(d.id);
      d.error ? p.fail(new Error(`${p.method}: ${d.error.message}`)) : p.ok(d.result);
      return;
    }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Fetch.requestPaused") {
      const { requestId, request, resourceType } = d.params;
      try {
        // Images first: curated thumbnails live on api.openverse.org too (/thumb/).
        if (resourceType === "Image" && !REAL_IMAGES && !request.url.startsWith("data:") && !request.url.includes("127.0.0.1")) {
          await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "image/png" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: PNG.toString("base64") });
        } else if (resourceType !== "Image" && request.url.includes("api.openverse.org")) {
          await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: Buffer.from(FIXTURE).toString("base64") });
        } else {
          await send("Fetch.continueRequest", { requestId });
        }
      } catch { /* page navigated away */ }
    }
  });

  await send("Runtime.enable");
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*api.openverse.org*" }, { resourceType: "Image" }] });
  await send("Emulation.setTimezoneOverride", { timezoneId: TIMEZONE });
  await send("Emulation.setLocaleOverride", { locale: "en-US" });
  const vp = VIEWPORTS[viewport] || viewport;
  await send("Emulation.setDeviceMetricsOverride", vp);
  if (vp.mobile) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (now) {
    // Fixed start time; the clock keeps ticking from there.
    await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
      const offset = new Date(${JSON.stringify(now)}).getTime() - Date.now();
      const Real = Date;
      class FakeDate extends Real {
        constructor(...a) { a.length ? super(...a) : super(Real.now() + offset); }
        static now() { return Real.now() + offset; }
      }
      globalThis.Date = FakeDate;
    })();` });
  }

  const page = {
    errors,
    send,
    /** Evaluate an expression (or async IIFE) in the page and return its JSON value. */
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    },
    /** Poll until the expression is truthy; returns its value. */
    async waitFor(expr, { timeout = 5000, interval = 50 } = {}) {
      const end = Date.now() + timeout;
      let last;
      while (Date.now() < end) {
        last = await page.eval(expr).catch((e) => e.message);
        if (last && !(typeof last === "string" && last.startsWith("Error"))) return last;
        await sleep(interval);
      }
      throw new Error(`Timed out waiting for: ${expr} (last: ${JSON.stringify(last)})`);
    },
    async goto(path, { ready = "document.querySelector('#title')?.textContent.trim()" } = {}) {
      await send("Page.navigate", { url: new URL(path, process.env.BASE_URL).href });
      await sleep(150);
      await page.waitFor(ready, { timeout: 10000 });
    },
    /** Wait until no CSS/Web animations are running (list slide-ins, panel, flying photo). */
    async settle(timeout = 2000) {
      await page.waitFor("document.getAnimations().filter((a) => a.playState === 'running' && !String(a.animationName || '').match(/sweep|pulse/)).length === 0", { timeout }).catch(() => {});
    },
    /** Center of the first element matching a CSS selector (scrolled into view). */
    async center(selector) {
      await page.settle();
      const r = await page.eval(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const b = el.getBoundingClientRect();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      })()`);
      if (!r) throw new Error(`No element: ${selector}`);
      return r;
    },
    async clickAt(x, y) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    },
    async click(selector) { const { x, y } = await page.center(selector); await page.clickAt(x, y); },
    async hover(selector) { const { x, y } = await page.center(selector); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); },
    async tap(selector) {
      const { x, y } = await page.center(selector);
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    async swipe(x1, y1, x2, y2, steps = 8) {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x1, y: y1 }] });
      for (let i = 1; i <= steps; i++) {
        await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] });
        await sleep(16);
      }
      // Hold still before lifting, so Chrome doesn't start a fling: the next touch
      // would only stop the fling and never become a click.
      await sleep(120);
      await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x2, y: y2 }] });
      await sleep(120);
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    async key(k) {
      const vk = KEYS[k] ?? k.toUpperCase().charCodeAt(0);
      const text = k.length === 1 ? k : k === "Enter" ? "\r" : undefined;
      const code = k.length === 1 ? (k === " " ? "Space" : `Key${k.toUpperCase()}`) : k;
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, text });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    },
    async type(text) { await send("Input.insertText", { text }); },
    /** A summary of what is on screen, for assertions. */
    state() {
      return page.eval(`(() => ({
        title: document.querySelector('#title').textContent,
        view: document.querySelector('#stage').dataset.view,
        hash: location.hash,
        days: [...document.querySelectorAll('.day')].map((d) => d.dataset.day),
        photoCards: document.querySelectorAll('.card.photo').length,
        plainCards: document.querySelectorAll('.card.plain').length,
        panelOpen: document.body.classList.contains('panel-open'),
        popOpen: !document.getElementById('acctPop').hidden,
        welcomeVisible: getComputedStyle(document.getElementById('welcome')).display !== 'none',
        todayDisabled: document.querySelector('#todayBtn').disabled,
      }))()`);
    },
    async screenshot(name) {
      mkdirSync(ARTIFACTS, { recursive: true });
      const r = await send("Page.captureScreenshot", { format: "png" });
      const file = new URL(`${name}.png`, ARTIFACTS);
      writeFileSync(file, Buffer.from(r.data, "base64"));
      return file.pathname;
    },
    async close() {
      try { ws.close(); } catch {}
      proc.kill();
      await sleep(300);
      try { rmSync(profile, { recursive: true, force: true }); } catch {}
    },
  };
  return page;
}
