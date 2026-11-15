# Contributing

```sh
npm run serve   # then open http://localhost:8000/?mock
npm test
```

You need Node 22+ and Chrome. [CLAUDE.md](CLAUDE.md) has the commands and the
pitfalls. To use your own Firebase project, see [docs/SETUP.md](docs/SETUP.md).

## Workflow

- Branch from `main`. Whatever merges to `main` is live within a minute.
- `npm test` must pass; CI runs it too. For visual changes, look at the
  `npm run screenshots` output.
- Fix a UI bug together with an e2e test that would have caught it.
- If you change `firestore.rules`, publish them in the Firebase console yourself.

## Code

- Plain ES modules: no framework, TypeScript or build step.
- Build DOM with `h()` from `js/util.js`. Put event text in with
  `textContent`, never `innerHTML`. `linkify()` is the one exception.
- Comments explain *why*.

## Design principles

- **Calendar first.** Time, title and place must be easy to scan. Photos never get in the way.
- **A plain card beats a wrong photo.**
- **Light and calm.** Motion stays at 500 ms or less, eases out, and never blocks input.
- **Works on a phone.** Tap targets are at least 40 px, with no horizontal scroll.
- **Accessible.** Use real buttons and links, keep focus visible, give actions
  keyboard shortcuts, and respect reduced motion.
- **Plain words.** "Reconnect", not "Re-authenticate".
- **Private.** Calendar data and tokens stay in the browser. Only settings
  and uploaded photos go to Firestore.

## Common tasks

- **New kind of event with automatic photos:** see [tools/curate-photos/README.md](tools/curate-photos/README.md).
- **New profile field:** add it to `blankProfile()` and `sanitize()` in
  `js/store.js`, so old documents still load.
