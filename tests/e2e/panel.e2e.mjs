// The event panel and photo picker.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch, sleep } from "./browser.mjs";

let page;
before(async () => { page = await launch(); await page.goto("?mock#week"); });
after(async () => { assert.deepEqual(page.errors, [], "no console errors"); await page.close(); });

const card = (title) => `[data-id="${title}"]`;
// Cards are found by title; returns a selector for the first match.
async function cardSel(title) {
  const id = await page.eval(`[...document.querySelectorAll('.card')].find((c) => c.querySelector('.c-title').textContent === ${JSON.stringify(title)})?.dataset.id`);
  assert.ok(id, `card "${title}" exists`);
  return card(id);
}
const isOpen = () => page.eval("document.body.classList.contains('panel-open')");
async function closeWithEsc() {
  await page.key("Escape");
  await page.waitFor("!document.body.classList.contains('panel-open')");
}

test("the panel opens with its photo in place: no copy of the card's photo flies in", async () => {
  const sel = await cardSel("Coffee with Alex");
  await page.waitFor(`document.querySelector('${sel} > .c-art > .ph.shown')`);
  await page.eval("window.__extra = 0; new MutationObserver((m) => m.forEach((r) => r.addedNodes.forEach((n) => { if (n.nodeType === 1 && getComputedStyle(n).position === 'fixed' && getComputedStyle(n).backgroundImage !== 'none') __extra++; }))).observe(document.body, { childList: true }); 1");
  await page.click(sel);
  await page.waitFor("document.body.classList.contains('panel-open')");
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.pv-photo > .ph')).visibility"), "visible");
  await closeWithEsc();
  await page.waitFor("document.getElementById('panel').hidden");
  assert.equal(await page.eval("window.__extra"), 0);
  assert.equal(await page.eval(`getComputedStyle(document.querySelector('${sel} > .c-art > .ph')).visibility`), "visible");
});

test("opens from a card with the event details and focus on Close", async () => {
  await page.click(await cardSel("Coffee with Alex"));
  await page.waitFor("document.querySelector('.pv-title')?.textContent === 'Coffee with Alex'");
  assert.equal(await page.eval("document.activeElement.classList.contains('pv-close')"), true);
  assert.match(await page.eval("document.querySelector('.pv-when').textContent"), /3:00 – 4:00 PM/);
  assert.match(await page.eval("document.querySelector('.pv-row a').href"), /google\.com\/maps/);
  // The page behind is inert while the sheet is open.
  assert.equal(await page.eval("document.getElementById('stage').inert"), true);
});

test("links to Google Calendar for editing and viewing", async () => {
  const links = await page.eval("[...document.querySelectorAll('.pv-links a')].map((a) => ({ text: a.textContent, href: a.href, target: a.target }))");
  assert.equal(links[0].text, "Edit in Google Calendar");
  assert.match(links[0].href, /^https:\/\/calendar\.google\.com\/calendar\/r\/eventedit\/[A-Za-z0-9%_-]+$/);
  assert.match(links[1].href, /^https:\/\/calendar\.google\.com\/calendar\/event\?eid=/);
  assert.ok(links.every((l) => l.target === "_blank"));
});

test("Esc closes it and returns focus to the card", async () => {
  const sel = await cardSel("Coffee with Alex");
  await closeWithEsc();
  assert.equal(await page.eval(`document.activeElement === document.querySelector('${sel}')`), true);
});

test("a click right after closing opens the next event (nothing blocks input)", async () => {
  await page.click(await cardSel("Gym"));
  await page.waitFor("document.body.classList.contains('panel-open')");
  await page.key("Escape");
  await page.click(await cardSel("Dentist"));
  await page.waitFor("document.querySelector('.pv-title')?.textContent === 'Dentist'");
  await closeWithEsc();
});

test("double-clicking a card opens the panel and keeps it open", async () => {
  const { x, y } = await page.center(await cardSel("Dentist"));
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(80);
  await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 2 });
  await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 2 });
  await sleep(500);
  assert.equal(await isOpen(), true);
  await closeWithEsc();
});

test("clicking the scrim closes the panel", async () => {
  await page.click(await cardSel("Gym"));
  await page.waitFor("document.body.classList.contains('panel-open')");
  await sleep(400);
  await page.clickAt(40, 500);
  await page.waitFor("!document.body.classList.contains('panel-open')");
});

test("an event without a photo has a slim header band", async () => {
  // Quarterly planning has a call tucked over it: the first tap spreads them, the second opens it.
  const sel = await cardSel("Quarterly planning");
  await page.click(sel);
  await page.waitFor(`document.querySelector('${sel}').closest('li').classList.contains('dk-open')`);
  await page.click(sel);
  await page.waitFor("document.querySelector('.pv-photo.is-empty')");
  assert.equal(await page.eval("getComputedStyle(document.querySelector('.pv-photo')).height"), "60px");
});

test("the picker shows one row of photos, then all of them", async () => {
  await page.waitFor("document.querySelectorAll('.pk-item.ready').length >= 3");
  const visible = () => page.eval("[...document.querySelectorAll('.pk-item')].filter((b) => b.offsetParent).length");
  assert.equal(await visible(), 3);
  await page.click(".pk-more");
  assert.equal(await visible(), 12);
  assert.equal(await page.eval("document.activeElement === document.querySelectorAll('.pk-item')[3]"), true);
});

test("choosing a photo for every title with a keyword updates the list", async () => {
  await page.click("#scope-keyword + .sc-txt");
  await page.eval("const k = document.getElementById('kwInput'); k.value = 'planning'; k.dispatchEvent(new Event('input'))");
  await page.click(".pk-item:nth-child(5)");
  await page.waitFor("document.querySelector('.pk-status')?.textContent.startsWith('Saved')");
  await page.waitFor("!document.querySelector('.pv-photo').classList.contains('is-empty')");
  await sleep(800); // picker rebuilds after saving
  assert.equal(await page.eval("document.querySelectorAll('.pk-item').length > 3 && !document.querySelector('.pk-grid').classList.contains('collapsed')"), true, "grid stays expanded");
  const cls = await page.eval("[...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Quarterly planning')).className");
  assert.match(cls, /photo/);
});

test("Use the automatic photo removes the choice", async () => {
  await page.waitFor("[...document.querySelectorAll('.link-btn')].some((b) => b.textContent === 'Use the automatic photo')");
  await page.eval("[...document.querySelectorAll('.link-btn')].find((b) => b.textContent === 'Use the automatic photo').click()");
  await page.waitFor("document.querySelector('.pk-status')?.textContent === 'Back to the automatic photo'");
  const cls = await page.eval("[...document.querySelectorAll('.card')].find((c) => c.textContent.includes('Quarterly planning')).className");
  assert.match(cls, /plain/);
});

test("uploading an image sets it as the event's photo", async () => {
  const file = join(tmpdir(), "bc-upload.png");
  writeFileSync(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOIyuuBIwacHAA0pg/xmjATKQAAAABJRU5ErkJggg==", "base64"));
  await page.click("#scope-event + .sc-txt");
  const { root } = await page.send("DOM.getDocument", {});
  const { nodeId } = await page.send("DOM.querySelector", { nodeId: root.nodeId, selector: "#pkFile" });
  await page.send("DOM.setFileInputFiles", { nodeId, files: [file] });
  await page.waitFor("document.querySelector('.pk-status')?.textContent.startsWith('Saved')");
  await page.waitFor("document.querySelector('.pv-credit')?.textContent === 'Your photo'");
  await closeWithEsc();
});

test("Remove photo hides an automatic photo for every repeat, and it can come back", async () => {
  const hasPhoto = () => page.eval("[...document.querySelectorAll('.card')].filter((c) => c.querySelector('.c-title').textContent === 'Gym').map((c) => !!c.querySelector('.c-art, .c-thumb'))");
  assert.ok((await hasPhoto()).every(Boolean), "Gym starts with its automatic photo");
  await page.click(await cardSel("Gym"));
  await page.waitFor("document.querySelector('.pk-remove')");
  assert.equal(await page.eval("document.getElementById('scope-series').checked"), true);
  await page.click(".pk-remove");
  await page.waitFor("document.querySelector('.pk-status')?.textContent.startsWith('Photo removed')");
  assert.equal(await page.eval("document.querySelector('.pv-photo').classList.contains('is-empty')"), true);
  assert.equal(await page.eval("document.querySelector('.pk-src').textContent"), "You removed the photo for every repeat");
  assert.equal(await page.eval("!!document.querySelector('.pk-remove')"), false, "nothing left to remove");
  const after = await hasPhoto();
  assert.ok(after.length > 1 && !after.some(Boolean), "no Gym card has a photo");
  await page.click(".pk-actions .link-btn:not(.pk-remove)"); // Use the automatic photo
  await page.waitFor("document.querySelector('.pk-status')?.textContent === 'Back to the automatic photo'");
  await page.waitFor("!document.querySelector('.pv-photo').classList.contains('is-empty')");
  assert.ok((await hasPhoto()).every(Boolean), "the automatic photo is back");
  await closeWithEsc();
});
