# Architecture

Everything runs in the browser, with no server of our own. Firestore keeps the
settings that should follow you between devices. Calendar events are fetched
from Google, cached in memory, and never stored.

```
index.html ─► js/main.js ─┬─► store.js   Firebase Auth + Firestore
                          ├─► google.js  tokens per account, Calendar API
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

users/{uid}/photos/{id}   { data: "data:image/jpeg;base64,..." }

Pick = { type: "upload", id } | { url, thumb, credit }
```

`store.update(fn)` writes the whole profile document. Uploads that no rule
uses any more are deleted.

## Accounts and events

- Each linked account has its own token. A 401 or a missing token raises
  `ReauthError`, which puts the account in `S.reconnect` and shows a Reconnect button.
- Events are cached for 5 minutes per account and range. Neighbouring ranges
  are prefetched when the browser is idle.
- Declined events are dropped. A meeting that is in two accounts is shown once
  (deduplicated by `iCalUID + start`).

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

## Panel

On open, a `.fly` clone of the card's photo animates (WAAPI) into the panel's
hero; on close it flies back and fades out over the card. The clone has
`pointer-events: none`, so it never blocks input.
