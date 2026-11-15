# Better Calendar

Your Google Calendar as a list of photo cards, grouped by day, in Day, Week or
Month view. It can show calendars from several Google accounts at once.

**Open it:** https://nano-shino.github.io/better-calendar/. If you don't sign in,
it shows sample events.

Settings and uploaded photos sync through Firebase. Calendar data and access
tokens stay in your browser.

## Using it

- **Accounts.** Add more Google accounts, or hide calendars, from the avatar menu.
- **Photos.** Open an event to pick, search for or upload a photo (dropping or
  pasting one also works). Apply it to that event, to every repeat, or to every
  title containing a word. An image link in the description works too.
- **Automatic photos** come from a hand-checked set. They appear only when
  the title clearly names a kind of event, such as gym, flight, dinner or
  birthday. Nothing is guessed, and you can turn them
  off in the avatar menu.
- **Keys:** `D` `W` `M` views, `←` `→` move, `T` today, `Esc` close. On phones, swipe.

## Development

```sh
npm run serve   # http://localhost:8000/?mock: signed-in state with sample events
npm test
```

Node 22+ and Chrome; nothing to install. See [CONTRIBUTING.md](CONTRIBUTING.md),
[CLAUDE.md](CLAUDE.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/SETUP.md](docs/SETUP.md) (to run your own copy).

Photos are Creative Commons images found through [Openverse](https://openverse.org),
credited in each event's panel.
