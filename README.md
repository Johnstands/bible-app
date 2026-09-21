# Bible App

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

Tests: `npm test` (reference parser) and `cargo test` in `src-tauri/` (needs `bible.db` to exist).

Keys: `/` or `Ctrl+K` opens Go to (try `jn 3:16`), `Ctrl+F` searches (quotes match an exact phrase), `Ctrl+L` opens the Library, `Ctrl+,` opens Settings, `←` `→` change chapter. Click a verse to select it (shift-click for a range).

Search speed is enforced by `cargo test --release` (100 ms); the plain `cargo test` uses a looser bound because unoptimized builds are about 4x slower.

See [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## Looking at the UI without the desktop app

`scripts/ui` runs the UI in headless Chromium against a mock of the Rust commands (real Bible text, marks kept in memory), so flows can be exercised and screenshotted without a Tauri window:

```sh
npm run ui:dev                          # a Vite server on :1430
node scripts/ui/shots.mjs out           # selection, highlights, notes
node scripts/ui/shots-settings.mjs out  # settings and text features
node scripts/ui/shots-library.mjs out   # Library and verse of the day
```

It expects Chromium at `/usr/bin/chromium` (override with `CHROMIUM`).
