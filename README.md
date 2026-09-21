# KJV Reader's Bible

Offline-first desktop Bible app built with Tauri v2, React and TypeScript.

## Development

Requires Node, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run data:fetch   # download the KJV source from eBible.org
npm run data:build   # build src-tauri/resources/bible.db (needs Node 22+)
npm run tauri dev
```

The Bible text (public domain KJV, 66 books) is imported into a bundled,
read-only SQLite database with an FTS5 search index. Notes, highlights and bookmarks
go in a separate `user.db` in the app data directory.

Tests: `npm test` (parser, glossary, settings, theme contrast and more), `cargo test` in `src-tauri/` (needs `bible.db` to exist), and `npm run test:ui` (the real interface in headless Chromium against a mock backend; needs Chromium, see below).

Keys: `/` or `Ctrl+K` opens Go to (try `jn 3:16`), `Ctrl+F` searches (quotes match an exact phrase), `Ctrl+L` opens the Library, `Ctrl+,` opens Settings, `←` `→` change chapter. Click a verse to select it (shift-click for a range), or use the keyboard: `J`/`K` move through the verses, `Space` selects, `B`/`N`/`C` bookmark, note and copy, `1`-`5` highlight, `W` opens the next word's meaning. Click an underlined word for its meaning. All the shortcuts are listed in Settings.

Search speed is enforced by `cargo test --release` (100 ms); the plain `cargo test` uses a looser bound because unoptimized builds are about 4x slower.

See [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## Looking at the UI without the desktop app

`scripts/ui` runs the UI in headless Chromium against a mock of the Rust commands (real Bible text, marks kept in memory), so flows can be exercised and screenshotted without a Tauri window:

```sh
npm run ui:dev                          # a Vite server on :1430
node scripts/ui/shots.mjs out           # selection, highlights, notes
node scripts/ui/shots-settings.mjs out  # settings and text features
node scripts/ui/shots-library.mjs out   # Library and verse of the day
node scripts/ui/shots-words.mjs out     # word help
```

It expects Chromium at `/usr/bin/chromium` (override with `CHROMIUM`).

## Word help

Archaic words and words whose meaning has changed are underlined; click one for its meaning. The list lives in `data/glossary.txt`, one entry per line (`forms | kind | meaning | today | verses`; the format is explained at the top of the file). `npm test` checks it against the real Bible text. To look for words still missing, run `npm run data:fetch -- web` and then `npm run glossary:gaps`, which lists words that are common in the KJV but absent from the modern World English Bible. `npm run glossary:review` writes `docs/glossary-review.md`, a checklist of every entry with real verses beside it, for reviewing the definitions.

## Building and releasing

`npm run tauri build` makes the Linux packages (a `.deb` and an AppImage) in `src-tauri/target/release/bundle/`. Releases, signing and the update mechanism are described in [docs/RELEASING.md](docs/RELEASING.md).

The UI tests and screenshot scripts need Chromium. They look for `/usr/bin/chromium`; set `CHROMIUM` to use another browser. `node scripts/ui/axe-summary.mjs` (with `npm run ui:dev` running) lists accessibility findings across every screen and theme.
