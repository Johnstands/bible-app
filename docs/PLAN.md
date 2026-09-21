# KJV Reader's Bible Plan (Tauri v2)

## Decisions
| Decision | Choice |
|---|---|
| Frontend | React + Vite + TypeScript |
| Storage | SQLite (bundled Bible DB plus a separate user DB) |
| Translation | KJV only (public domain). The schema keeps a `translation` column, so adding one later is an import-script change. |
| Platforms | Linux first, then Windows and macOS. Mobile later. |
| Online features | None in v1 (offline-first) |

## Phase 0: Setup (done)
- Rust, Node and the Tauri prerequisites installed.
- Scaffolded with `create-tauri-app`, demo code removed.
- **Done when:** an empty window opens with `npm run tauri dev`.

## Phase 1: Data layer (done)
- Find public domain Bible data (JSON or USFM) and write an import script.
- Schema: `translations`, `books`, `verses(translation, book, chapter, verse, text)`.
- Build an FTS5 index over the verse text.
- Add a separate `user.db` (in the app data dir) for notes, highlights and bookmarks.
- **Done when:** a Rust command returns any chapter and a search query returns results.
- **Result:** `scripts/build-bible-db.mjs` builds `bible.db` from eBible.org USFX (KJV, 31,102 verses). Rust commands: `list_translations`, `list_books`, `get_chapter`, `search`. Covered by `cargo test`.
- **Known gaps for later phases:** the KJV source tags words with Strong's numbers (Phase 5 option) but has no cross-references, so those need another public-domain source.

## Phase 2: Reader (done)
- Book and chapter picker, verse rendering, previous/next chapter, keyboard shortcuts.
- Reference jump box ("jn 3:16").
- Remember the last position.
- **Done when:** you can read the whole Bible comfortably.
- **Result:** paragraphs, poetry lines, stanza breaks, Psalm titles, Psalm 119 letter headings and epistle subscriptions render from the imported structure (`Chapter.tsx`). The Go-to panel (`/` or Ctrl+K, or click the location) is both the jump box and a book/chapter browser; `reference.ts` parses "jn 3:16", "1 cor 13", "ps 23:1-3" and unique prefixes, with tests. Arrow keys move between chapters across books, a jump to a verse scrolls to it and washes it in gold, and the last chapter and scroll position are restored on launch (`localStorage`). The `t` key cycles themes until Phase 4 adds settings.

## Phase 3: Search (done)
- Full-text search with highlighted matches and result snippets.
- Filters by testament or book.
- **Done when:** search returns results in well under 100 ms.
- **Result:** the Search panel (`Ctrl+F` or the top-bar button) searches as you type, with stemming ("love" also finds "loved"), exact phrases in quotes, filters for the whole Bible, either testament or one book, highlighted matches, a total count, "Show more" paging, and Enter or click to jump to the verse. The Go-to panel offers a "Search for" row for anything typed, and the last query and filters are remembered. Release-build timing: 42 ms for the worst case ("the", 27k matches), under 10 ms for everything else (`cargo test --release`).

## Phase 4: Personalization (done)
- Verse selection, then highlight colors, notes and bookmarks.
- Settings panel (`Ctrl+,` or from the top bar):
  - Themes (paper, sepia, dark), replacing the temporary `t` key.
  - Font size control (a slider or steps, with a live preview) and font family.
  - **Text features:**
    - **Verse by verse** (toggle): each verse on its own line instead of flowing paragraphs. Poetry stays as it is.
    - **Pilcrows** (toggle): show a ¶ at the start of each paragraph, as in the 1611 text. The import already records paragraph starts (`new_block`), so this needs no data change.
  - Settings are saved and applied on launch.
- A verse of the day.
- **Result:**
  - **Selecting:** click a verse to select it, shift-click for a range, Ctrl-click to add or remove one, and Esc or a click in the margin to clear. A floating bar offers five highlight colors (click the active color again to remove it), Note, Bookmark and Copy (a quotation with its reference).
  - **Marks in the text:** highlights are washes of color, a bookmark is a small ribbon and a note is a small diamond you can click to reopen it.
  - **Notes:** one note per starting verse, which may cover a range.
  - **Library** (`Ctrl+L`): bookmarks, notes and highlights in one panel with verse text and dates, click to jump, × to remove.
  - **Settings** (`Ctrl+,` or "Aa"): themes, three bundled fonts, size from 85% to 160% with a live preview, and the verse-by-verse and pilcrow toggles. Verse by verse and pilcrows work together, so a ¶ marks where each paragraph starts even on one-verse lines.
  - **Verse of the day:** a curated list of 370 references (checked against the Bible in a test), one per day of the year, shown once per day on launch and available from Settings.
  - **Data:** `user.db` migrates in place (version 2 adds note ranges and one note per verse), with Rust tests for each behavior including the upgrade.
- **Follow-ups for Phase 6:** verses can only be selected with the mouse, so selection needs a keyboard path; the Library needs a screen-reader pass.

## Word help (added after Phase 4)
Purpose: help a modern reader understand the KJV. Words that are archaic, or that meant something else in 1611, get a broken underline; clicking one opens a small card with the meaning. Three levels in Settings: *Off*, *Changed meanings* (only the familiar-looking words that mislead) and *All words* (the default, which adds archaic words and old measures).
- **Three kinds of word** (`data/glossary.txt`, about 590 entries): *archaic* words (wist, straightway, swaddling), *changed meanings* or "false friends" (prevent = go before, conversation = conduct, charity = love, suffer = allow, corn = grain, meat = food), and *old measures* (cubit, ephah, shekel). Old pronouns and verb endings (thou, hath, -eth) and old spellings (shew, honour) are deliberately left out.
- **False friends come first.** An old word announces itself; a familiar one quietly misleads. Their underline is stronger, and the card contrasts *In the KJV* with *Today*.
- **Accuracy over coverage.** Words that keep their modern meaning almost everywhere ("let", "suffer", "meet", "whole", "knew", "ought") are defined only in the verses where the KJV sense applies, and a test checks that every listed verse really contains the word. Every entry was checked against real verses, and `npm test` fails if an entry names a word that never occurs in the KJV or two entries claim the same word in one verse.
- **How the word list was found:** archaic words are the ones frequent in the KJV but absent from the modern WEB (`npm run data:fetch -- web`, then `npm run glossary:gaps` lists what is still unexplained). False friends came from knowledge of the text, then were checked in context.
- **Caveat:** the definitions were written for this app, not taken from a published dictionary, so they should be reviewed by someone who knows the text well. `npm run glossary:review` writes `docs/glossary-review.md` (not committed): every entry with a checkbox and real verses to judge it against.
- **Follow-ups:** the words can only be opened with the mouse (a keyboard path belongs in the Phase 6 accessibility work); the card is not yet offered in Search results, the Library or the verse of the day.

## Phase 5: Depth features (3-5 days)
- Reading plans with progress tracking.
- Cross-references (needs a separate public-domain data source) and a copy or share verse card.
- Optional: audio, or Strong's and lexicon data.
- **Strong's numbers (done):** the KJV source tags about 349,000 phrases with Hebrew or Greek numbers, and Open Scriptures' edition of Strong's dictionaries supplies the entries. A setting ("Original-language words", off by default, or the S key) makes those words clickable: the card shows the original word, Strong's definition, how the KJV renders it, and a link that lists every verse using it (search `H7225` or `G26` works too). `word_tags` and `strongs` tables in `bible.db`; `src-tauri/src/strongs.rs`; `src/wordUnits.ts` merges the tags with word help.

## Phase 6: Polish and ship (done, apart from the optional title bar)
- App icon, window state, accessibility pass.
- Tests: Rust unit tests for the DB layer, Playwright for the UI flows. `scripts/ui` already drives the UI headlessly against a mock backend, so it is the starting point.
- Bundle with `tauri build` (AppImage, deb, and others), and set up the auto-updater.
- **Result:**
  - **Keyboard:** `J`/`K` move a verse cursor, `Space` selects, `Shift+J`/`K` extend, `B`/`N`/`C` bookmark, note and copy, `1`-`5` highlight, and `W`/`Shift+W` step through the glossary words. A live region reads each action out. The shortcuts are listed in Settings.
  - **Accessibility:** the page behind a dialog is inert, dialogs give focus back when they close, lists use the right ARIA patterns (combobox, listbox, tabs), and muted text was darkened to pass WCAG AA in all three themes. axe-core reports nothing on any screen in any theme, and a test keeps it that way, along with a unit test for the theme contrast ratios.
  - **Icon:** an open book with the gold diamond ornament from the chapter headings, on the oxblood of the accent color (`assets/icon.svg`, rendered by `scripts/make-icon.mjs`, sizes made with `tauri icon`).
  - **Window:** size, position and maximised state are remembered (`tauri-plugin-window-state`).
  - **UI tests:** `npm run test:ui` drives the real interface in headless Chromium against a mock backend (57 tests: flows, keyboard, accessibility, updates). CI runs it with everything else.
  - **Packaging:** `npm run tauri build` makes a `.deb` and an AppImage for Linux. The release build was run and checked: it finds its bundled Bible, fonts and icon.
  - **Updates:** the app checks GitHub Releases when it opens (and from Settings), offers a newer signed version in a quiet banner, and installs it on request. A tagged push builds a draft release (`docs/RELEASING.md`).
- **Not done:** a custom title bar (the system one is dark and clashes with the paper theme); Windows and macOS builds; the release workflow has not been run on GitHub yet, so the first real release is its first test.

## Risks
- **Licensing:** stick to public domain until you have licenses for modern translations.
- **Data quality:** validate imports against known verse and chapter counts.
- **Scope creep:** ship Phases 0-4 as v1.
