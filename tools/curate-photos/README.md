# Curating automatic photos

Automatic photos (`js/curated.js`) are a few hand-checked photos for each kind
of event. Searching for photos at runtime gave mismatches, so it isn't done.

## Adding a kind of event (example: `pizza`)

1. Add a theme to `THEMES` in `js/photos.js`:
   `{ key: "pizza", label: "pizza", q: "pizza", re: /\b(pizza)\b/i }`.
   The first match wins, so put specific kinds first, and match whole words only.
2. Add titles that should match to `MATCHES` in `tests/unit/photos.test.mjs`,
   and near-misses that should stay plain to `PLAIN`.
3. Add a search phrase to `QUERIES` in `fetch.mjs`, then run
   `node tools/curate-photos/fetch.mjs pizza`. This adds candidates to
   `candidates.json` and writes contact sheets to `out/`.
4. Pick 2–3 photos that clearly show the theme, and add their indexes to
   `PICKS` in `build.mjs`. Cards crop to a wide band, so check the full image.
5. Run `node tools/curate-photos/build.mjs`, then `npm test`.

`PICKS` indexes refer to `candidates.json`, so commit that file too. Running
`fetch.mjs` with no arguments refetches every theme and invalidates every pick.
