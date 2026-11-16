// Accounts menu, reconnect banner, settings and the signed-out welcome card.
// ?mock = fake signed-in state: you@example.com (main) + work@example.com (needs reconnect).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { launch } from "./browser.mjs";

let page;
before(async () => { page = await launch(); await page.goto("?mock#week"); });
after(async () => { assert.deepEqual(page.errors, [], "no console errors"); await page.close(); });

const popOpen = () => page.eval("!document.getElementById('acctPop').hidden");

test("shows a reconnect banner for an expired account, and Reconnect clears it", async () => {
  assert.match(await page.eval("document.getElementById('banner').textContent"), /work@example\.com/);
  assert.equal(await page.eval("!!document.querySelector('.av-alert')"), true);
  await page.click("#banner .btn");
  await page.waitFor("document.getElementById('banner').hidden");
  assert.equal(await page.eval("!!document.querySelector('.av-alert')"), false);
});

test("the menu opens, stays open while used, and an outside click only closes it", async () => {
  await page.click("#acctBtn");
  assert.equal(await popOpen(), true);
  await page.click(".pop .pa-head");
  assert.equal(await popOpen(), true, "clicking inside keeps it open");
  await page.click(".card.photo");
  assert.equal(await popOpen(), false);
  assert.equal(await page.eval("document.body.classList.contains('panel-open')"), false, "the click didn't open the card underneath");
});

test("Esc closes the menu and returns focus to the avatar button", async () => {
  await page.click("#acctBtn");
  await page.key("Escape");
  assert.equal(await popOpen(), false);
  assert.equal(await page.eval("document.activeElement.id"), "acctBtn");
});

test("hiding a calendar removes its events", async () => {
  await page.click("#acctBtn");
  const id = await page.eval("[...document.querySelectorAll('.cal')].find((l) => l.textContent.includes('Work')).getAttribute('for')");
  await page.click(`label[for="${id}"]`);
  assert.equal(await page.eval("document.body.textContent.includes('Team standup')"), false);
  await page.click(`label[for="${id}"]`);
  assert.equal(await page.eval("document.querySelector('#stage').textContent.includes('Team standup')"), true);
  assert.equal(await popOpen(), true);
});

test("turning off automatic photos (under Advanced) leaves only plain cards", async () => {
  const before = (await page.state()).photoCards;
  assert.ok(before > 3);
  await page.click(".pop .adv-sum");
  await page.waitFor("document.querySelector('.pop .adv')?.open");
  await page.click('label[for="autoPhotos"]');
  assert.equal((await page.state()).photoCards, 0);
  await page.click('label[for="autoPhotos"]');
  assert.equal((await page.state()).photoCards, before);
});

test("adding accounts shows two avatars and a count", async () => {
  await page.click(".pa-add");
  await page.click("#acctBtn");
  await page.click(".pa-add");
  const avatars = await page.eval("[...document.querySelectorAll('#acctBtn .av')].map((a) => a.textContent)");
  assert.deepEqual(avatars, ["S", "W", "+2"]);
});

test("signing out leaves an empty calendar with the welcome card", async () => {
  await page.click("#acctBtn");
  await page.eval("[...document.querySelectorAll('.pop .link-btn')].find((b) => b.textContent === 'Sign out').click()");
  await page.waitFor("getComputedStyle(document.getElementById('welcome')).display !== 'none'");
  assert.match(await page.eval("document.getElementById('welcome').textContent"), /Sign in with Google/);
  await page.waitFor("!!document.querySelector('.agenda-empty')");
  const s = await page.state();
  assert.equal(s.photoCards + s.plainCards, 0, "no sample events");
  assert.match(await page.eval("document.querySelector('.agenda-empty').textContent"), /try the demo/);
});

const cards = async () => { const s = await page.state(); return s.photoCards + s.plainCards; };

test("Try the demo shows sample events, and Exit demo empties the calendar again", async () => {
  await page.click("#welcome .wc-demo");
  await page.waitFor("document.querySelectorAll('.card').length > 0");
  assert.ok(await cards() > 0);
  assert.match(await page.eval("document.getElementById('welcome').textContent"), /sample events/);
  assert.equal(await page.eval("document.querySelector('#welcome .wc-demo').textContent"), "Exit demo");
  await page.click("#welcome .wc-demo");
  await page.waitFor("!!document.querySelector('.agenda-empty')");
  assert.equal(await cards(), 0);
});

test("the account menu offers the demo too", async () => {
  await page.click("#acctBtn");
  await page.click(".pop .pa-demo");
  await page.waitFor("document.querySelectorAll('.card').length > 0");
  assert.equal(await page.eval("document.querySelector('.pop .pa-demo').textContent"), "Exit demo");
  assert.match(await page.eval("document.getElementById('acctPop').textContent"), /Sample calendars/);
  await page.click(".pop .pa-demo");
  await page.waitFor("!!document.querySelector('.agenda-empty')");
  await page.key("Escape");
});

// Google's consent-screen review checks that the home page shows the app's name
// and links to the privacy policy.
test("the welcome card names the app and links to the privacy policy", async () => {
  const shown = await page.eval("[...document.querySelectorAll('#welcome strong span')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.textContent).join('')");
  assert.match(shown, /Better Calendar/);
  const href = await page.eval("document.querySelector('#welcome a.wc-link').href");
  assert.match(href, /\/privacy\.html$/);
  assert.equal((await fetch(href)).status, 200);
  await page.click("#acctBtn");
  assert.equal(await page.eval("[...document.querySelectorAll('.pop a')].some((a) => a.textContent === 'Privacy' && a.href === " + JSON.stringify(href) + ")"), true);
  await page.key("Escape");
});

test("the welcome card can be dismissed for the session", async () => {
  await page.click(".wc-x");
  assert.equal((await page.state()).welcomeVisible, false);
  await page.goto("#week");
  assert.equal((await page.state()).welcomeVisible, false);
});

test("picking a theme recolors the page, and it is still picked after a reload", async () => {
  const bg = () => page.eval("getComputedStyle(document.body).backgroundColor");
  assert.equal(await page.eval("document.documentElement.dataset.theme"), "light");
  assert.equal(await bg(), "rgb(255, 255, 255)");
  await page.click("#acctBtn");
  await page.click('label[for="th-dracula"]');
  assert.equal(await page.eval("document.documentElement.dataset.theme"), "dracula");
  assert.equal(await bg(), "rgb(40, 42, 54)");
  assert.equal(await page.eval("document.querySelector('meta[name=theme-color]').content"), "#282a36");
  assert.equal(await popOpen(), true, "the menu stays open while picking");

  await page.reload();
  assert.equal(await bg(), "rgb(40, 42, 54)");
  await page.click("#acctBtn");
  assert.equal(await page.eval("document.getElementById('th-dracula').checked"), true);

  // Auto follows the system, whichever it is on this machine.
  await page.click('label[for="th-auto"]');
  const system = await page.eval("matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'");
  assert.equal(await page.eval("document.documentElement.dataset.theme"), system);
  await page.click('label[for="th-light"]');
  await page.key("Escape");
});

test("Advanced holds the immersive cards switch: dark photo cards, kept after a reload", async () => {
  // Its own browser: earlier tests here change settings that a real reload keeps.
  const page = await launch();
  try {
    await page.goto("?mock#week");
    const cardBg = () => page.eval("getComputedStyle(document.querySelector('.card.photo')).backgroundImage");
    const glowShown = () => page.eval("getComputedStyle(document.querySelector('.card.photo .c-glow')).display !== 'none'");
    await page.waitFor("document.querySelector('.card.photo')");
    assert.equal(await cardBg(), "none", "photo cards are paper by default");
    assert.equal(await glowShown(), false);

    await page.click("#acctBtn");
    assert.equal(await page.eval("document.querySelector('.pop .adv').open"), false, "Advanced starts folded");
    await page.click(".pop .adv-sum");
    await page.waitFor("document.querySelector('.pop .adv')?.open");
    await page.click('label[for="immersiveCards"]');
    assert.equal(await page.eval("document.documentElement.dataset.cards"), "immersive");
    assert.match(await cardBg(), /gradient/);
    assert.equal(await glowShown(), true);
    assert.equal(await page.eval("!document.getElementById('acctPop').hidden"), true, "the menu stays open while switching");

    await page.reload();
    assert.equal(await page.eval("document.documentElement.dataset.cards"), "immersive", "applied before the app runs");
    await page.waitFor("document.querySelector('.card.photo')");
    await page.click("#acctBtn");
    await page.click(".pop .adv-sum");
    await page.waitFor("document.querySelector('.pop .adv')?.open");
    assert.equal(await page.eval("document.getElementById('immersiveCards').checked"), true);
    await page.click('label[for="immersiveCards"]');
    assert.equal(await page.eval("document.documentElement.dataset.cards"), undefined);
    assert.equal(await cardBg(), "none");
    assert.deepEqual(page.errors, []);
  } finally { await page.close(); }
});
