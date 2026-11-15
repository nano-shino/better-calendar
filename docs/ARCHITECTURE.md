# Architecture

```
index.html ──► js/main.js ──┬─► js/store.js   ── Firebase Auth + Firestore (profile, uploads)
                            ├─► js/google.js  ── GIS tokens per account + Calendar API v3
                            ├─► js/views.js   ── renderList(): days → cards
                            ├─► js/panel.js   ── event panel + photo picker
                            └─► js/photos.js  ── photoFor(ev) / choose() / search()
                                     └─► js/curated.js (generated photo set)
```

Everything runs in the browser and there is no server of our own. Firebase
keeps the settings that should follow you between devices. Google Calendar
data is fetched fresh, cached in memory, and never stored.

## Boot

1. `main.js` reads the view from the hash (`#week`), or else from
   `localStorage` `bd:view`, or else uses week. It wires the controls and calls
   `boot()`.
2. With `?mock`, `store.useMock()` installs a fake user and an in-memory
   profile, and events come from `sample.js`.
3. Otherwise, `store.init()` imports Firebase from the CDN and listens for
   auth.
   - Signed out: show sample events and the welcome card.
   - Signed in: subscribe to `users/{uid}`; the signed-in Google account becomes
     `accounts[0]` (`owner: true`); `google.initGis()` loads the token client.
4. `go()` loads the range and renders.

## Data

### Firestore

```
users/{uid}
  accounts:  [{ email, name, picture, owner? }]   linked Google accounts
  hidden:    ["<account>|<calendarId>", ...]      calendars switched off
  rules:
    event:    { "<event id>":  Pick }             this occurrence only
    series:   { "<seriesId>":  Pick }             every repeat
    keywords: [{ word, pick: Pick }]              any title containing word
  view:      "week" | ...                         (legacy; the view is stored in localStorage)
  autoPhotos: boolean                             automatic photos on/off
  updatedAt

users/{uid}/photos/{id}
  data: "data:image/jpeg;base64,..."   (< 750 KB, rules enforce < 900 000 chars)

Pick = { type: "upload", id }                          an uploaded photo
     | { url, thumb, credit: { by, license, link } }  a picked web photo
```

`store.update(fn)` mutates the in-memory profile, notifies listeners and writes
the whole document. `photos.js` `editRules()` deletes uploaded photos that no
rule references any more.

### Google Calendar

- **Tokens.** Each account gets a GIS token client with `login_hint` and the
  `calendar.readonly` scope. Tokens are kept in `localStorage` `bd:tok:<email>`
  with their expiry (about one hour).
  - A 401 response, or a missing token, raises `ReauthError`. `main.js` then
    adds the email to `S.reconnect`, and the banner and popover show a
    Reconnect button.
- **Fetching.** `accountEvents(email, start, end)` lists the account's
  calendars once, then fetches every calendar's events for the range in
  parallel.
  - The result is cached in `S.cache` for 5 minutes per account and range.
  - `prefetch()` loads the next and previous ranges when the browser is idle.
  - Everything is refreshed every 10 minutes.
- **`normalize()`** gives a flat event:
  `{ id, uid (iCalUID), seriesId (recurringEventId), title, description, location, start, end, allDay, calKey, calName, account, color, link (htmlLink), meet, attendees }`.
  Declined and cancelled events are dropped.
- **Duplicates.** The same meeting in two accounts is deduplicated by
  `uid + start`.

## Navigation and rendering

- **State** lives in the object `S` in `main.js`.
  - `S.view` and `S.anchor` describe what is on screen.
  - `S.target` is where navigation is heading. Fast repeated key presses build
    on the target, not on the screen.
  - `S.seq` drops stale responses.
- **Ranges.** `rangeOf(view, anchor)`:
  - day: one day;
  - week: seven days from the locale's first weekday (`WEEK_START`; Sunday for en-US);
  - month: the 1st to the next 1st.
- **`go()`** loads events, then `render()`. It updates the hash with
  `replaceState`, and `animateIn(kind)` adds a short CSS enter class:
  `enter-next`, `enter-prev`, `enter-zoom-in`, `enter-zoom-out` or `enter-fade`.
- **`views.renderList(days, events, ctx, mode)`** builds the page:
  - **Day sections.** One per day with events. Empty days in a row collapse into
    one "free" row, such as "17–19 Nov". Today always gets a section, saying
    "Nothing planned today" when it's empty.
  - **Card types.**
    - Photo card: a big image band. Used when `expectsPhoto(ev)` and the event
      is the series' *lead* occurrence (the next upcoming one in range,
      otherwise the first).
    - Compact row with a thumbnail: other occurrences of a repeating event.
    - Plain card with a lettered tile: no photo.
  - **Now line.** Inserted in today's section between past and upcoming events.
    Skipped while an event is live; live events show a progress bar instead
    (`--progress`).
  - **Photos.** Painted asynchronously by `paintPhoto()`, which fades in once
    `photoFor()` resolves.
- **Timers.** `render(true)` runs every 60 s to keep "now" and past states
  current, keeping the scroll position.

## Photos (`js/photos.js`)

`photoFor(ev)` resolves in this order (first match wins), memoized per event:

1. `rules.event[ev.id]`
2. `rules.series[ev.seriesId]`
3. `rules.keywords`: the first word contained in the title
4. An image URL inside the event description
5. When `autoPhotos` is on and `themeFor(ev)` matches: `CURATED[theme][hash(seriesId||title) % n]`
6. Otherwise `null`, which gives a plain card

Other functions:
- `themeFor()` tests `THEMES` in order. Specific kinds come first, and each has
  an English regex.
- `search()` queries Openverse for the picker only. Results are cached 7 days
  in localStorage and at most 4 requests run at once.
- `choose(ev, scope, pick, word)` saves a rule.
- `upload(file)` compresses to JPEG and stores it with `store.putPhoto`.

To add a theme, see [tools/curate-photos/README.md](../tools/curate-photos/README.md).

## Event panel (`js/panel.js`)

- **Layout.** A right-side panel on desktop and a bottom sheet on phones
  (`max-width: 720px`).
- **`openPanel(ev, cardEl)`** builds the content and adds `.opening`. It makes
  the rest of the page `inert`, and moves focus to the close button.
  - If the card has a photo, a `.fly` clone of it animates (WAAPI) from the card
    to the panel's hero band. The real hero is hidden until the clone lands.
- **`closePanel()`** plays `.closing`, flies the photo back and fades it into
  the card, then hides the panel after 300 ms. Focus returns to the card.
- **The clone** is `pointer-events: none` and lives outside the hit path, so
  input is never blocked. This replaced the View Transitions API, which
  swallowed clicks (see CLAUDE.md).
- **The picker** offers:
  - scope radios: this event, every repeat, or a keyword;
  - suggestions and search (a collapsed grid with "More photos");
  - upload by file, drop or paste;
  - "Back to the automatic photo".
  `refreshPanel()` rebuilds it after data reloads, keeping the scroll position.
- **Links.** "Edit in Google Calendar" goes to
  `/calendar/r/eventedit/<eid>?authuser=<account>`; "View" goes to
  `/calendar/event?eid=…`.

## Styling

- `css/app.css` is a single file in this order: tokens, base, header, agenda
  and cards, panel and picker, popover, banner and welcome, shared keyframes,
  then small screens.
- Light theme only.
- Fonts: Geist and Geist Mono from Google Fonts, loaded without blocking.
- Motion tokens are `--ease`, `--ease-in` and `--spring`.
- Respect `prefers-reduced-motion`, which already disables the enter and fly
  animations.

## Testing setup

- `tests/e2e/browser.mjs` launches headless Chrome with `--remote-debugging-port=0`
  and talks to it over the DevTools Protocol, using the WebSocket built into
  Node with no npm packages. It sets:
  - a fixed clock and the UTC timezone,
  - the en-US locale,
  - viewport and touch emulation,
  - fetch interception for photos.
- Each `*.e2e.mjs` file opens one browser and runs its tests in order.
  `tests/e2e/run.mjs` starts `tests/serve.mjs` on a random port and passes it as
  `BASE_URL`.
- CI (`.github/workflows/test.yml`) runs `npm test` on Ubuntu with the
  preinstalled Chrome.
