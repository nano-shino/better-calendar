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

test("turning off automatic photos leaves only plain cards", async () => {
  const before = (await page.state()).photoCards;
  assert.ok(before > 3);
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

test("signing out returns to sample events with the welcome card", async () => {
  await page.click("#acctBtn");
  await page.eval("[...document.querySelectorAll('.pop .link-btn')].find((b) => b.textContent === 'Sign out').click()");
  await page.waitFor("getComputedStyle(document.getElementById('welcome')).display !== 'none'");
  assert.match(await page.eval("document.getElementById('welcome').textContent"), /Sign in with Google/);
});

test("the welcome card can be dismissed for the session", async () => {
  await page.click(".wc-x");
  assert.equal((await page.state()).welcomeVisible, false);
  await page.goto("#week");
  assert.equal((await page.state()).welcomeVisible, false);
});
