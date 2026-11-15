# Better Calendar: notes for contributors and AI agents

Google Calendar shown as a list of photo cards (Day / Week / Month). A static
site with **no build step**: plain ES modules, served as-is by GitHub Pages
from `main`. It uses Firebase Auth and Firestore (free Spark plan), Google
Identity Services, and calls the Calendar API from the browser.

Live: https://nano-shino.github.io/better-calendar/. Pushing to `main` deploys it.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing data flow,
photos or the event panel. [CONTRIBUTING.md](CONTRIBUTING.md) covers the
workflow and the design rules.

## Commands

```sh
npm run serve          # http://localhost:8000  (no install step; Node >= 22, no dependencies)
npm test               # unit + browser tests (needs Chrome; set CHROME_PATH if it isn't found)
npm run test:unit
npm run test:e2e -- panel   # only e2e files whose name contains "panel"
npm run screenshots    # desktop/tablet/phone PNGs into tests/.artifacts/ for a visual check
```

There is nothing to `npm install`. Keep it that way: no frameworks, bundlers or
runtime dependencies. Firebase is loaded from the gstatic CDN in `js/store.js`
(version pinned in `V`).

## Trying the UI without signing in

- `http://localhost:8000/?mock` gives a fake signed-in state: `you@example.com`, plus
  `work@example.com`, which needs a reconnect. It uses sample events and keeps
  data in memory only. Every e2e test uses this mode.
- With no `?mock` and signed out, the page shows sample events with a welcome card.
- `#day`, `#week` and `#month` in the URL pick the view.
- Sample events (`js/sample.js`) are generated relative to *today*, and the tests freeze
  the clock at **Mon 2026-11-16 10:00, UTC, en-US**. If you change the sample
  data, update the e2e expectations to match.

## Map

| File | Role |
|---|---|
| `index.html` | Shell markup: header, `#stage`, account popover, panel, welcome, toast |
| `js/main.js` | App state `S`, navigation (`go`, `nav`, `setView`), data loading and caching, accounts popover, keyboard and swipe, boot. `?mock` branches live here |
| `js/views.js` | `renderList()`: builds the day sections and cards from events. Pure DOM, with no fetching |
| `js/panel.js` | Event side panel / bottom sheet, the photo picker, the flying-photo animation, Google Calendar links |
| `js/photos.js` | Picking a photo for an event (rules, themes, curated set), Openverse search for the picker, upload compression |
| `js/curated.js` | **Generated** by `tools/curate-photos/build.mjs`. Don't edit by hand |
| `js/store.js` | Firebase init, auth, the profile document, uploaded photo documents, mock store |
| `js/google.js` | Per-account GIS tokens (localStorage), Calendar API calls, event normalization |
| `js/util.js` | `h()` element helper, date math, `Intl` formatters, small helpers |
| `js/config.js` | Public Firebase web config and OAuth client ID. These are safe to commit, not secrets |
| `css/app.css` | All styles. Design tokens are on `:root`; light theme only |
| `firestore.rules` | Security rules. Paste into the Firebase console when they change; this repo doesn't deploy them |
| `tests/` | `unit/` (node:test, pure logic), `e2e/` (headless Chrome over raw CDP), `serve.mjs` |
| `tools/curate-photos/` | Scripts for choosing the automatic photos. See its README |

## Rules learned the hard way

- **No View Transitions API.** While a view transition runs, Chrome sends every
  pointer hit to the root, so clicks and taps are silently lost. This happens
  even with `pointer-events: none`. Navigation uses CSS enter classes
  (`.agenda.enter-next` and similar); the panel uses `.opening`/`.closing`
  classes and a `.fly` clone animated with WAAPI.
- **`[hidden]` must win.** `css/app.css` has `[hidden]{display:none!important}`
  because components set `display:flex`. Toggle visibility with `el.hidden`.
- **Class names are global.** A generic class such as `.empty` once matched two
  components. Prefix classes with their component: `.pv-photo.is-empty`,
  `.agenda-empty`, `.fr-days`.
- **No guessed photos.** An event gets an automatic photo only when its title
  clearly names a kind of event (`THEMES` in `js/photos.js`) and that theme has
  hand-checked photos. Otherwise it shows a plain card. Never fill gaps with
  search results.
- **Firestore documents are capped at 1 MiB.** Uploads are compressed below
  750 KB and stored one per document in `users/{uid}/photos/{id}`; the rules
  enforce under 900 000 characters. Rule changes save the whole profile
  document (`store.update`).
- **Google tokens last about an hour** and there is no refresh token without a
  backend. Tokens live only in `localStorage` (`bd:tok:<email>`), never in
  Firestore. An expired account goes into `S.reconnect` and shows a Reconnect
  button. Re-auth must start from a user click, because browsers block the popup otherwise.
- **The panel's scrim ignores the second click of a double-click**, and any
  click within 350 ms of opening, so a double-clicked card doesn't open and
  then close at once.
- **Google event links:** take `eid` from `htmlLink` with a regex.
  URLSearchParams would turn `+` into a space. Edit link:
  `calendar.google.com/calendar/r/eventedit/<eid>?authuser=<email>`.
- **Paths are relative** (`./js/...`), because the site is served from
  `/better-calendar/`.
- Keep the user-visible copy plain and specific. The UI text is short sentences
  without jargon.

## Tests

- Browser tests drive real input: CDP `Input.dispatchMouseEvent`, touch and key
  events. Overlay and hit-testing bugs therefore fail the tests. Don't swap in
  `element.click()`.
- `page.settle()` waits for running animations. `center()`, and so `click()`
  and `tap()`, calls it first.
- Network is stubbed. Openverse returns `tests/e2e/fixtures/openverse.json` and
  every remote image is a tiny PNG. Firebase and font CDNs still load for real.
- Each test file asserts there were **no console errors**.
- `page.swipe()` holds still before lifting the finger. A fling would make
  Chrome swallow the next tap.
- Add an e2e test for any bug you fix in UI behaviour. Use `npm run screenshots`
  and look at the PNGs for visual changes at all three sizes.
