# Bible App Plan (Tauri v2)

## Decisions
| Decision | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Storage | SQLite (bundled Bible DB plus a separate user DB) |
| Translations at launch | KJV and WEB (public domain) |
| Platforms | Linux first, then Windows and macOS. Mobile later. |
| Online features | None in v1 (offline-first) |

## Phase 0: Setup (done)
- Rust, Node and the Tauri prerequisites installed.
- Scaffolded with `create-tauri-app`, demo code removed.
- **Done when:** an empty window opens with `npm run tauri dev`.

## Phase 1: Data layer (1-2 days)
- Find public domain Bible data (JSON or USFM) and write an import script.
- Schema: `translations`, `books`, `verses(translation, book, chapter, verse, text)`.
- Build an FTS5 index over the verse text.
- Add a separate `user.db` (in the app data dir) for notes, highlights and bookmarks.
- **Done when:** a Rust command returns any chapter and a search query returns results.

## Phase 2: Reader (2-3 days)
- Book and chapter picker, verse rendering, previous/next chapter, keyboard shortcuts.
- Reference jump box ("jn 3:16").
- Remember the last position.
- **Done when:** you can read the whole Bible comfortably.

## Phase 3: Search (1-2 days)
- Full-text search with highlighted matches and result snippets.
- Filters by testament or book.
- **Done when:** search returns results in well under 100 ms.

## Phase 4: Personalization (2-3 days)
- Verse selection, then highlight colors, notes and bookmarks.
- Themes (light, dark, sepia) and font size and family settings.
- A verse of the day.

## Phase 5: Depth features (3-5 days)
- Side-by-side translation compare.
- Reading plans with progress tracking.
- Cross-references and a copy or share verse card.
- Optional: audio, or Strong's and lexicon data.

## Phase 6: Polish and ship (2-3 days)
- App icon, window state, accessibility pass.
- Tests: Rust unit tests for the DB layer, Playwright for the UI flows.
- Bundle with `tauri build` (AppImage, deb, and others), and set up the auto-updater.

## Risks
- **Licensing:** stick to public domain until you have licenses for modern translations.
- **Data quality:** verse numbering differs between translations, so validate the imports.
- **Scope creep:** ship Phases 0-4 as v1.
