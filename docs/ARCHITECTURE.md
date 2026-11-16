# Architecture

Everything runs in the browser. Firestore keeps the settings that should follow
you between devices. Calendar events are fetched from Google, cached in memory,
and never stored (only the calendar list is kept in `localStorage`, see below). The one server is an optional token Worker that keeps Google
accounts connected (see below).

```
index.html ─► js/main.js ─┬─► store.js   Firebase Auth + Firestore
                          ├─► google.js  tokens per account, Calendar API ─► worker/ (tokens only)
                          ├─► views.js   days → cards
                          ├─► panel.js   event panel, photo picker
                          └─► photos.js  photo for each event ─► curated.js
```

## Firestore

```
users/{uid}
  accounts:   [{ email, name, picture, owner? }]   linked Google accounts; owner = signed-in one
  hidden:     ["<account>|<calendarId>"]           calendars switched off
  rules:      { event: {id: Pick}, series: {seriesId: Pick}, keywords: [{ word, pick }] }
  autoPhotos: boolean
  done:       { "<iCalUID>|<start ms>": markedAt }      events marked done; no titles or other event data

users/{uid}/photos/{id}   { data: "data:image/jpeg;base64,..." }

Pick = { type: "upload", id } | { url, thumb, credit }
```

`store.update(fn)` writes the whole profile document. Uploads that no rule
uses any more are deleted.

## Accounts and events

- Each linked account has its own token. When it is missing or expired,
  `google.js` asks the Worker for a new one. If that fails (or there is no
  Worker), `ReauthError` puts the account in `S.reconnect` and shows a Reconnect button.
- Events are fetched a month at a time, widened to whole weeks (`blockOf`), so
  Day, Week and Month over the same dates share one request and switching
  between them waits for nothing. Requests in flight are shared. The months on
  either side are prefetched when the browser is idle.
- A block is fresh for 5 minutes. After that it is still shown at once and
  refetched behind it; the list re-renders if it is still on screen.
- Each account's calendar list is kept in `localStorage` (`bd:cals:<email>`:
  names, colors, no events) and refreshed in the background, so events don't
  wait for it. Signing out or removing the account deletes it.
- On a reload, events for the remembered accounts (`bd:session`) that still
  have a live token start loading at once, while Firebase restores the session.
- Declined events are dropped. A meeting that is in two accounts is shown once
  (deduplicated by `iCalUID + start`).

## Token Worker

`worker/index.js`, on Cloudflare Workers' free plan, with refresh tokens in KV
(AES-GCM, bound to the user and account).

```
sign in:   Google code popup ─► POST /connect {code} ─► refresh token stored
           ◄─ Google ID token ─► signInWithCredential (Firebase, no second popup)
add/reconnect account:  same popup ─► POST /connect {code, idToken}
expired token:          POST /token {idToken, email} ─► new access token
remove account:         POST /disconnect ─► revoked at Google, deleted
```

`idToken` is the Firebase ID token; the Worker checks its signature and uses
its `sub` as the user. Without a `tokenWorkerUrl`, or while the Worker is
skipped after a failure, the old one-hour popups are used instead.

## Navigation

`S.view` and `S.anchor` are what's on screen. `S.target` is where navigation
is heading, so fast repeated key presses build on it. `S.seq` drops stale
responses.

## Rendering

- Days in a row with no events collapse into one "free" row. Today always
  gets a section.
- **Card types.** A repeating event gets a big photo card only for its *lead*
  occurrence: the next upcoming one in range, or else the first. Its other
  occurrences become compact rows. Events without a photo are plain cards.
- Photos paint asynchronously once `photoFor()` resolves.

## Photos

`photoFor(ev)` takes the first match:

1. Rule for this event
2. Rule for its series
3. Keyword rule: the first word the title contains
4. An image URL in the description
5. With `autoPhotos` on, if `themeFor(ev)` matches: a curated photo, picked by hashing the series or title
6. Otherwise none, which gives a plain card

Openverse search is used only in the picker.

## Done

`js/done.js` keeps a key per occurrence, the same `uid|start` that dedupes a
meeting across accounts, so marking it done in one account hides it in all.
Marks for events more than 400 days old are dropped on the next change. The
list shows events that aren't done; `S.tab = "done"` shows only those that are,
for the same range.

`js/gestures.js`: a sideways drag that starts on a card (touch, mouse, or a
two-finger trackpad swipe as wheel `deltaX`) moves the card and, past about a
third of its width, marks it done (on the Completed tab, not done). A sideways
touch swipe anywhere else changes the range. Cards have `touch-action: pan-y`,
so vertical scrolling stays native.

Marking done never jumps: `leave()` in `main.js` fades the card and folds its row
(or its day) closed, then `renderSmooth()` re-renders and animates every row
from where it was (FLIP, matched by event id). Waits on animations go through
`ended()`, because a hidden tab pauses them and `.finished` would never come.

## Panel

The panel slides in with its photo already in place; the card's photo doesn't
animate into it (a flying copy looked worse than a plain slide).
