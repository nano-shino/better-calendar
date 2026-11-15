# Better Calendar

Your Google Calendar as a list of photo cards, one event after another, grouped
by day. Switch between Day, Week and Month. It reads calendars from several
Google accounts at once.

**Open it:** https://nano-shino.github.io/better-calendar/. Without signing in it
shows sample events.

It's a static site on GitHub Pages. Your settings and uploaded photos sync
through Firebase. Calendar data and access tokens stay in your browser.

## Using it

- **Accounts.** Sign in with Google. Add more Google accounts from the avatar
  menu (top right), where you can also hide individual calendars.
- **Photos.** Click any event to open it, then pick a suggestion, search, or
  upload, drop or paste your own photo. Apply it to that event, to every repeat,
  or to every event whose title contains a word.
- **Automatic photos** appear only when the title clearly names a kind of event:
  gym, flight, dinner, birthday, meeting and about 25 more.
  They come from a hand-checked set. Everything else stays a plain
  card, and nothing is guessed. You can turn them off in the avatar menu.
- An image link in an event's description is used as its photo.
- **Keyboard:** `D` `W` `M` switch views, `←` `→` move, `T` goes to today, `Esc`
  closes the panel. On phones, swipe left or right. Click a day's date to open
  that day.
- **Google Calendar.** Use "Edit in Google Calendar" in the panel; it opens the
  event in the right account.
- Events you declined are hidden. A meeting that appears in two of your accounts
  is shown once.

### Where each photo comes from (first match wins)
1. A photo you chose for this event
2. A photo you chose for every repeat of the series
3. A keyword photo (for example, any title containing "gym")
4. An image link in the event's description
5. An automatic photo, when the title clearly names a kind of event

## Development

```sh
npm run serve     # http://localhost:8000/?mock: fake signed-in state, no Google needed
npm test          # unit + headless-Chrome tests
```

No build step and no dependencies; you need Node 22+ and Chrome.

- [CONTRIBUTING.md](CONTRIBUTING.md): workflow, code style, design principles
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): modules, data model, rendering, photos
- [docs/SETUP.md](docs/SETUP.md): host your own copy with your own Firebase project
- [CLAUDE.md](CLAUDE.md): a quick map and pitfalls, for humans and AI agents

Photos: Creative Commons images via [Openverse](https://openverse.org). Credits
are shown in each event's panel.
