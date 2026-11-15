# Curating automatic photos

Automatic photos (`js/curated.js`) are a small, hand-checked set: a few photos per
kind of event. They are never picked by search at runtime. Early versions
searched Openverse per event and the results often didn't match. A plain card
is better than a wrong photo.

## Adding a new kind of event (example: `pizza`)

1. **Matching.** In `js/photos.js`, add an entry to `THEMES`:
   `{ key: "pizza", label: "pizza", q: "pizza", re: /\b(pizza)\b/i }`.
   Order matters: put specific kinds before general ones, because the first match wins.
   Keep the regex strict and match whole words only.
2. **Tests.** Add titles to the `MATCHES` table in `tests/unit/photos.test.mjs`,
   and add near-misses that should stay plain to `PLAIN`.
3. **Candidates.** Add a search phrase to `QUERIES` in `fetch.mjs`, then run:
   ```sh
   node tools/curate-photos/fetch.mjs pizza
   ```
   This merges 16 candidates into `candidates.json` and writes contact sheets to
   `tools/curate-photos/out/`.
4. **Review.** Open `out/sheet0.html` and note the indexes of 2–3 photos that
   clearly show the theme, then add them to `PICKS` in `build.mjs`. Look at the
   full-size image too (`url` in `candidates.json`), because cards crop to a wide band.
5. **Build.** `node tools/curate-photos/build.mjs` regenerates `js/curated.js`.
   Photos whose URL no longer loads are dropped.
6. `npm test`, then check the cards in `?mock` mode.

`candidates.json` is committed because the `PICKS` indexes refer to it. Running
`fetch.mjs` with no arguments refetches every theme and reorders the results,
so only do that when you mean to redo every pick.
