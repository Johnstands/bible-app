# Slides in playlists — plan

Adding slide decks (PowerPoint, Keynote, PDF, plain images) to a presentation-mode playlist, so a
service can go *welcome slide → Psalm 100 → song lyrics → John 3:16 → announcements* and
Next/Previous steps straight through all of it.

Status: **step 1 of 4 built** (image slides + click-to-jump), on branch `slides-import`, not merged.
See "Progress" at the end.

## What the user sees

1. In the dock's Playlist section, a new **Add slides…** button next to the existing passage flow.
2. A file picker accepting `.pptx`, `.ppt`, `.key`, `.odp`, `.pdf`, `.png`, `.jpg`/`.jpeg`.
3. A progress line in the dock: *"Converting with PowerPoint…"* (or Keynote / LibreOffice / "Reading
   PDF…"). A few seconds per deck.
4. The deck appears as **one playlist item**, e.g. `▣ Sunday.pptx · 12 slides`, with a small
   thumbnail. Like a passage, it can be moved up/down or removed, and it expands into its individual
   slides when presenting. A passage expands into verses the same way.
5. While presenting, the dock's live preview and the projection window show the slide image,
   letterboxed on black to fit the screen. The Dark/Light and verse/whole toggles don't affect
   image slides.
6. **Switching freely between verses and slides while live**, not just stepping in order:
   - **Click any playlist item** in the dock to put it on screen at once: a passage goes to its
     first verse, a deck to its first slide. Today the dock's item list isn't clickable, and the
     only way to move is Next/Previous.
   - **Deck items expand** into a strip of slide thumbnails. Click any thumbnail to jump straight to
     that slide (e.g. back to the chorus slide).
   - **The item on screen is highlighted** in the list, so it's always clear where Next goes.
   - **An unplanned verse mid-slides:** select verses in the reader → **Present now**. The app
     already remembers the playlist position while showing an ad-hoc passage (`adHoc` state is
     separate from `queueIndex`), so **Return to the playlist** lands back on the exact slide that
     was up. The button's wording follows what it returns to: "Back to Sunday.pptx, slide 7".
   - Implementation: `buildQueueSlides` also returns, per playlist item, the index of its first
     slide (`itemStarts: number[]`), so "jump to item *i*" is `setQueueIndex(itemStarts[i])` and
     "which item is live" is a lookup the other way. Clicking an item while an ad-hoc passage is up
     leaves ad-hoc mode, like Return does.
7. If the source file changed, a **Re-import** action on the item re-runs the conversion from the
   original path (if it still exists). Otherwise the user picks the file again.

What does **not** carry over: animations, transitions, embedded video/audio, speaker notes. Each
slide is a still image of its final, fully-built state. The dock says so the first time.

## How a .pptx gets turned into images

The app never draws PowerPoint slides itself (in this plan; see "Later" for that option). It asks
a presentation program already on the computer to export them, trying in this order:

| Order | Platform | Converter | Mechanism |
|---|---|---|---|
| 1 | Windows | Microsoft PowerPoint | A PowerShell script drives PowerPoint through COM automation: `Presentations.Open(path, ReadOnly, Untitled, WithWindow=false)`, then `Slide.Export(out, "PNG", 1920, h)` per slide, then close. |
| 1 | macOS | Keynote (free on every Mac), else PowerPoint for Mac | `osascript`. Keynote: `export … as slide images with properties {image format: PNG}`. PowerPoint: `save … as save as PNG`. |
| 2 | any | LibreOffice | `soffice --headless --convert-to pdf --outdir <tmp> <file>`, then the PDF path below. |
| — | any | *(none found)* | Import refused with a clear message: "Export it as a PDF from PowerPoint/Google Slides/Keynote and add that instead." |

**PDFs** (and LibreOffice's output) are rasterized **in the app's own webview with pdf.js**
(`pdfjs-dist`), page by page onto a canvas at 1920px wide, then the PNG bytes are sent to Rust to
store. No external program is needed, so PDF import works on every computer.

**Images** are copied as-is (one image = a one-slide deck).

Detecting what's installed is a small pure function, `choose_converter(platform, found) ->
Option<Converter>`, unit-tested like `present::choose_external`. The probing (checking known install
paths / the registry `App Paths` key on Windows, `/Applications/*.app` on macOS, `PATH` for
`soffice`) wraps it.

### Safety and robustness
- **The file path is never spliced into script text.** PowerShell gets it through an environment
  variable, and AppleScript through `on run argv`, so a filename with quotes or `$(...)` can't run
  anything.
- **Timeout** (~2 min) on every external program, and the process is killed on expiry. PowerPoint can
  hang on a repair prompt or a password-protected file.
- PowerPoint/Keynote are only opened read-only and closed afterwards. If PowerPoint was **already
  running** with the user's own files, we open our file as a separate presentation and close only
  that one, never `Quit` the app.
- Conversion runs off the UI thread (a Tauri async command). The dock stays usable, and a second
  import is refused while one is running.
- macOS: add `NSAppleEventsUsageDescription` to the bundle's Info.plist (Tauri: `bundle.macOS`
  `infoPlist`). Without it, macOS silently blocks controlling Keynote/PowerPoint. The first import
  shows the system "allow Bible App to control Keynote?" prompt.

## Storage

Slide images live under the app data dir, next to `user.db`:

```
~/.local/share/com.jxyeverfight.bibleapp/decks/<deck id>/0001.png, 0002.png, …
```

(and the Windows/macOS equivalents). Copies, not links, so moving or deleting the original file
doesn't break a playlist.

**Serving the images to the webviews:** a custom URI scheme registered in Rust
(`register_asynchronous_uri_scheme_protocol("slides", …)`), resolving
`slides://localhost/<deck>/<n>` → that file. It only serves files inside `decks/`, and rejects `..`
and anything not matching the `<number>/<number>` shape. Preferred over enabling Tauri's general
asset protocol, which would need a broader filesystem scope. Both windows (main + presentation)
can load these URLs, so the projection window needs no new event payloads. It gets a small
`{kind: "image", src}` slide like any other state push.

## Database: migration 5 (not an edit to migration 4)

Migration 4 is unreleased but **already pushed to origin/main**, and supporting deck items means
rebuilding `playlist_items` anyway (SQLite can't drop `NOT NULL` from a column in place). So this
adds a **new** migration rather than editing migration 4 again. Nobody's database needs a hand fix,
including the developer's own.

```sql
CREATE TABLE decks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,            -- original filename, e.g. "Sunday.pptx"
    source_path TEXT,              -- for Re-import; may no longer exist
    slide_count INTEGER NOT NULL,
    converter TEXT NOT NULL,       -- "powerpoint" | "keynote" | "libreoffice" | "pdf" | "image"
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Rebuild playlist_items so an item is either a passage or a deck.
CREATE TABLE playlist_items_new (
    id INTEGER PRIMARY KEY,
    playlist INTEGER NOT NULL,
    position INTEGER NOT NULL,
    book INTEGER, chapter INTEGER, verse INTEGER, verse_end INTEGER,   -- passage items
    deck INTEGER REFERENCES decks(id),                                 -- deck items
    label TEXT,
    CHECK ((deck IS NULL) = (book IS NOT NULL AND chapter IS NOT NULL AND verse IS NOT NULL))
);
INSERT INTO playlist_items_new (id, playlist, position, book, chapter, verse, verse_end, label)
    SELECT id, playlist, position, book, chapter, verse, verse_end, label FROM playlist_items;
DROP TABLE playlist_items;
ALTER TABLE playlist_items_new RENAME TO playlist_items;
CREATE INDEX playlist_items_playlist ON playlist_items (playlist, position);
```

**Deck lifetime:** a deck is kept while any playlist item references it. After a playlist's items
are saved or a playlist is deleted, unreferenced decks are deleted, rows *and* their `decks/<id>/`
folder, in the same Rust call. One deck can be reused in several playlists.

## Code changes

**Rust (`src-tauri/`)**
- `user.rs`: migration 5; an upgrade test (v4 DB with passages → v5, passages intact, decks empty).
- `playlists.rs`: `PlaylistItem`/`NewItem` become tagged enums
  (`#[serde(tag = "kind")]` → `{kind: "passage", …}` / `{kind: "deck", deck, name, slideCount}`);
  `list_playlists` joins `decks`; `save_playlist_items`/`delete_playlist` garbage-collect decks.
- New `decks.rs`: `choose_converter` (pure, unit-tested), install probing, the three converter
  runners, `store_images(deck_id, pngs)`, `delete_deck_files`.
- New commands: `import_slides(path) -> ImportResult` (office formats and images;
  returns either a finished deck or `{needsPdfRender: tmpPdfPath}` for the pdf.js step),
  `store_rendered_pages(deckDraft, pages: Vec<bytes>) -> Deck`, `converter_available() -> Option<String>`
  (so the dock can say "PowerPoint found" up front).
- `lib.rs`: register the commands and the `slides://` protocol; add `tauri-plugin-dialog`.
- `capabilities/default.json`: `dialog:allow-open`. (The presentation window needs nothing new.)
- `tauri.conf.json`: macOS `infoPlist` with `NSAppleEventsUsageDescription`.

**Frontend (`src/`)**
- `api.ts`: `PlaylistItem`/`NewPlaylistItem` as discriminated unions; `toNewPlaylistItem` handles
  both; new `importSlides` / `storeRenderedPages` / `converterAvailable` wrappers.
- `presentation.ts`: `PresentSlide` becomes `VerseSlide | ImageSlide`; `buildQueueSlides` takes a
  list of *passages or decks* and expands decks into `{kind: "image", src, deckName, index, count}`
  slides. Unit tests extended.
- `PresentationView.tsx`: render `ImageSlide` as a centered, `object-fit: contain` image on black.
  Skip the text-fitting path for it. Blank still wins over everything.
- `App.tsx`: the queue-building effect handles deck items (no chapter fetch needed); an
  `addSlides()` flow: pick file → `importSlides` → if a PDF render is needed, rasterize with pdf.js
  → `storeRenderedPages` → append the deck item to the active playlist. Import progress/errors go
  through the existing `setNotice`.
- `PresentationDock.tsx`: **Add slides…** button (disabled with a hint when no playlist is active),
  deck rows with thumbnail + "12 slides", an importing state, Re-import. The live-status line shows
  "Slide 3 of 12 · Sunday.pptx" for image slides.
- New `src/pdfRender.ts`: pdf.js page → canvas → PNG bytes, with unit tests on a tiny fixture PDF.
- `package.json`: `pdfjs-dist`, `@tauri-apps/plugin-dialog`.

**UI test harness (`scripts/ui/`)**: mock `import_slides`/`store_rendered_pages` and a mock
`slides://` image (a data URL); new tests for adding a deck, reordering it among passages,
stepping Next across passage → slides → passage, and removing it.

## Build order (each step shippable/testable on its own)

1. **Data + display, images only.** Migration 5, deck types end to end, `slides://` protocol, image
   slides in the view/preview, PNG/JPG import, and **click-to-jump** (items, slide thumbnails,
   live highlight, "Back to … slide N"). Proves the whole pipeline without any converter.
2. **PDF import** via pdf.js.
3. **LibreOffice** `.pptx`/`.odp` → PDF → step 2. *Fully testable on this Linux machine
   (LibreOffice is installed).*
4. **PowerPoint (Windows) and Keynote/PowerPoint (macOS).** Written here and compiled by CI on
   those platforms, but **cannot be run here**. Needs manual testing on real machines (checklist
   below).

## Testing

Automated (all run here): `cargo test` (migration upgrade, deck GC, `choose_converter`, protocol
path validation), `npm test` (slide building with mixed items, pdf render), `npm run test:ui`
(dock flows), `tsc --noEmit`. Plus a real LibreOffice conversion of a sample `.pptx` on Linux.

**Manual checklist (needs someone with the machine):**
- Windows + PowerPoint: import a normal deck; a 4:3 deck (letterboxed); a deck while PowerPoint is
  already open with another file (that file must stay open); a password-protected deck (clean error,
  no hang); a filename containing quotes/`$`.
- Windows without PowerPoint but with LibreOffice: falls back to LibreOffice.
- Mac: first-import permission prompt appears and, once allowed, Keynote exports; with Keynote
  removed/denied, PowerPoint for Mac is used if present.
- Any machine with nothing installed: `.pptx` is refused with the "export as PDF" message; PDF and
  images still work.
- Plus the existing second-monitor checklist in `presentation-mode-plan.md`, now with image slides
  on the projector.

## Later (not in this plan)

- **Built-in .pptx renderer** as a last-resort fallback (read the pptx XML and draw text boxes,
  pictures, backgrounds, basic shapes). Good enough for typical church decks, but weak on charts,
  SmartArt, WordArt and missing fonts. Only worth it if "nothing installed" turns out to be common.
- Choosing a slide *range* from a deck, rather than the whole deck.
- Google Slides import by link (would need the network; the app is otherwise fully offline).

## Decisions

- **Switching between verses and slides must be free, not only in order** (user, 2026-09-24).
  Covered by item 6 of "What the user sees". Click-to-jump applies to passages too, so it's built
  in step 1.
- A deck is added whole for now (a range can be added later). Image slides are letterboxed on
  black. These are defaults, not user decisions yet; easy to change.

## Progress

### Step 1 — done (2026-09-24)

Built as planned, except that the importer takes **images only** for now, so the file picker offers
PNG/JPG/WebP/GIF. Several pictures chosen at once become one deck, ordered by filename with
numbers compared as numbers ("Slide2" before "Slide10"). The deck is named after the first file
("Slide2.png + 2 more").

- Rust: migration 5; `decks.rs` (`import_images`, the `slides://` handler `serve`, request-path
  validation, `delete_files`); `playlists.rs` items are a `kind`-tagged enum; save/delete return
  now-unused decks, and `commands.rs` deletes their folders; `import_slides` command (async);
  `tauri-plugin-dialog`, with `dialog:allow-open` in the main window's capability.
- Frontend: `PresentSlide = VerseSlide | ImageSlide`; `buildQueue` returns `{slides, items}` spans
  plus `itemAt`; the dock has click-to-jump items, a slide-thumbnail strip (always open for the live
  deck, toggle for others), the live highlight, "Back to … · 7 of 12", and **Add slides…**.
- Import and add-to-playlist happen in one DB transaction, so a fresh deck is never momentarily
  unused and can't be cleaned up in between.

**Existing layout bugs fixed along the way** (both from the first presentation-mode work):
- While presenting, the selection toolbar was centered on the whole window, so "Add to playlist"
  and the × ended up under the dock. It now centers over the reader, and on narrow windows sits
  above the bottom sheet.
- On narrow windows (≤900px) the bottom-sheet dock was still only 24rem wide. It's now full width,
  the preview is capped at 28rem, and the reader gets bottom padding so a chapter's last verses can
  scroll above the sheet.
- The UI tests' mock server wrote its response headers before running the command, so any command
  that threw crashed the request instead of returning its error. Fixed.

**Verified:** `cargo test` 83 (10 new: migration 4→5 upgrade, deck import/serve/cleanup, path
validation, serde shape); `npm test` 128; `npm run test:ui` 118 (new `tests/ui/slides.e2e.ts`, 9
tests incl. axe); `tsc` clean; the real app launched on this machine and migrated the developer's
own `user.db` from v4 to v5 with its playlist intact (backup at `user.db.bak-before-migration-5`).

**Not verified yet:** the real `slides://` scheme and the real file picker inside the Tauri window.
The UI tests use stand-ins for both. Next time the app is open: Present → a playlist → Add slides…
→ pick a few pictures → check they show in the dock and on the projection window.

### Next: step 2 (PDF import via pdf.js)
