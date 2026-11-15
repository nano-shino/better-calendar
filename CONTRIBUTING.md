# Contributing

## Getting started

```sh
git clone https://github.com/nano-shino/better-calendar.git
cd better-calendar
npm run serve        # then open http://localhost:8000/?mock
npm test
```

You need Node 22 or newer and Google Chrome (or set `CHROME_PATH` to a
Chrome/Chromium binary). There are no dependencies to install.

`?mock` gives you a signed-in UI with sample events and no Google account.
Real sign-in works only from origins listed in the OAuth client. To use your
own Firebase and Google Cloud project, follow [docs/SETUP.md](docs/SETUP.md).

## Workflow

1. Branch from `main`. `main` is what GitHub Pages serves, so anything merged
   goes live within a minute.
2. Keep changes focused. Link the issue in the PR.
3. Run `npm test`, which must pass; CI runs it too. For anything visual, run
   `npm run screenshots` and look at `tests/.artifacts/*.png`. That covers
   desktop (1440), tablet (768) and phone (390), in Day, Week and Month, plus
   the panel, accounts menu and signed-out state.
4. Fix a UI bug together with an e2e test that would have caught it.
5. If you change `firestore.rules`, paste them into the Firebase console. Say so
   in the PR.

## Code style

- Plain modern JavaScript as ES modules, with no build step, no framework and
  no TypeScript.
- Build DOM with `h(tag, attrs, ...children)` from `js/util.js`. Use
  `textContent` for user data and never `innerHTML` with event text.
  `linkify()` is the one safe exception for descriptions.
- Two-space indent, double quotes, semicolons (see `.editorconfig`).
- Prefix CSS classes with their component (`c-` card, `pv-` panel, `pk-`
  picker, `pa-` popover account, `fr-` free run, `dh-` day header).
- Comments explain *why*, not what.

## Design principles

- **Calendar first.** Events must be easy to scan: time, title and place.
  Photos add to that and never get in the way.
- **No guessed photos.** A plain card beats a wrong photo. Automatic photos
  come only from the hand-checked set in `js/curated.js`.
- **Light, calm and quick.** Use a light theme, generous whitespace and one
  accent per calendar colour. Motion should be short (≤ 500 ms) and ease out.
  Nothing should block input while it animates.
- **Works on a phone.** Use tap targets of at least 40 px, no horizontal
  scroll, a bottom-sheet panel and swipe navigation.
- **Accessible.** Use real buttons and links, keep focus visible, make the
  panel inert-trap the page, give everything a keyboard shortcut (D/W/M, ←/→,
  T, Esc), and support reduced motion.
- **Plain words.** UI copy is short and specific. Prefer "Reconnect" to
  "Re-authenticate"; prefer "Nothing planned today" to "No events".
- **Private by default.** Calendar data stays in the browser. Only settings and
  uploaded photos go to Firestore. Tokens never leave the device.

## Common tasks

- **Add a kind of event that gets an automatic photo:** see
  [tools/curate-photos/README.md](tools/curate-photos/README.md).
- **Change the sample data:** edit `js/sample.js`, then update the expectations
  in `tests/e2e/list.e2e.mjs` and the other e2e files. The tests freeze the
  clock at Mon 16 Nov 2026, 10:00.
- **Add a field to the profile:** add it to `blankProfile()` and `sanitize()`
  in `js/store.js` so old documents still load.
- **Bump Firebase:** change `V` in `js/store.js` and run the tests.
