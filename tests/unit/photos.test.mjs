// Which titles get an automatic photo. The rule: only titles that clearly name a
// kind of event; anything ambiguous stays plain. Add a row here when you add a theme.
import { test } from "node:test";
import assert from "node:assert/strict";

const { themeFor, expectsPhoto, autoQuery } = await import("../../js/photos.js");
const { CURATED } = await import("../../js/curated.js");

const MATCHES = {
  "Team standup": "meeting", "1:1 with Sam": "meeting", "Interview with candidate": "meeting",
  "Gym": "gym", "Morning run": "run", "Yoga class": "yoga", "Swimming": "swim",
  "Coffee with Alex": "coffee", "Brunch with Jo": "lunch", "Seafood dinner": "dinner",
  "Flight to Lisbon": "flight", "Trip to Portugal": "travel", "Hiking in Sintra": "hike",
  "Dentist": "dentist", "Doctor checkup": "doctor", "Mom's birthday": "birthday",
  "Concert": "concert",
};
const PLAIN = ["Quarterly planning", "Design review", "Run payroll", "Vet the proposal", "Case study review",
  "Rail project kickoff", "Pool party", "Training session", "Call with Bob", "Pick up package"];

test("titles that clearly name a kind of event match it", () => {
  for (const [title, key] of Object.entries(MATCHES)) assert.equal(themeFor({ title })?.key, key, title);
});

test("ambiguous titles match nothing (no guessed photos)", () => {
  for (const title of PLAIN) assert.equal(themeFor({ title }), null, title);
});

test("every theme has hand-checked photos", () => {
  for (const title of Object.keys(MATCHES)) {
    const key = themeFor({ title }).key;
    assert.ok(CURATED[key]?.length >= 2, `${key} has photos`);
    for (const p of CURATED[key]) assert.match(p.url, /^https:\/\//);
  }
});

test("expectsPhoto follows the theme, or an image link in the description", () => {
  assert.equal(expectsPhoto({ id: "a", title: "Gym", description: "" }), true);
  assert.equal(expectsPhoto({ id: "b", title: "Quarterly planning", description: "" }), false);
  assert.equal(expectsPhoto({ id: "c", title: "Quarterly planning", description: "See https://example.com/deck.png" }), true);
});

test("the picker's search starts from the theme or the title", () => {
  assert.equal(autoQuery({ title: "Gym", location: "" }), "gym");
  assert.equal(autoQuery({ title: "Quarterly planning", location: "" }), "quarterly planning");
});
