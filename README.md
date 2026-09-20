# Bible App

Offline-first desktop Bible app built with Tauri v2, React and TypeScript.

## Development

Requires Node, Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```sh
npm install
npm run data:fetch   # download the KJV and WEB sources from eBible.org
npm run data:build   # build src-tauri/resources/bible.db (needs Node 22+)
npm run tauri dev
```

The Bible text (public domain KJV and WEB, 66 books) is imported into a bundled,
read-only SQLite database with an FTS5 search index. Notes, highlights and bookmarks
go in a separate `user.db` in the app data directory. Rust unit tests: `cargo test`
in `src-tauri/` (they need `bible.db` to exist).

See [docs/PLAN.md](docs/PLAN.md) for the roadmap.
