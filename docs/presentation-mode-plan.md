# Presentation mode — design notes and status

Working notes for the church-presentation feature, kept in the repo (not just the Claude Code
session) so work can resume later without needing this conversation's history.

## Status as of this writing

Merged into `main` on 2026-09-24 (merge commit `60a2f73`, from the `presentation-mode` branch). Not yet pushed or released.

- Commit `96d0bdb` — first working version: ad-hoc presenting, a saved/queued "service" of
  passages, a modal control panel, auto-detected second-monitor fullscreen with a single-monitor
  fallback that took over the main window.
- Commit `5b6e1a0` — the full redesign described below, plus three small follow-up tweaks:
  - Removed the "High contrast" screen-color option; Dark/Light is now one toggle button instead
    of two separate buttons. The verse-by-verse/whole-passage choice is likewise one toggle button.
  - Fixed a latent CSS bug found while touching this: the "Blank screen" button's pressed state had
    no visual highlight (a leftover `.pres-group` class nothing actually used); now uses `.pres-row
    button[aria-pressed="true"]` so it lights up correctly.
  - Renamed the user-facing term "Service" to **"Playlist"** everywhere it appears in the UI.
- Next commit — the internal rename to match: `services.rs` → `playlists.rs`, `Service`/
  `ServiceItem`/`NewServiceItem` → `Playlist`/`PlaylistItem`/`NewPlaylistItem`, the Tauri commands
  (`list_playlists`, `create_playlist`, `rename_playlist`, `delete_playlist`,
  `save_playlist_items`), the `api.ts` wrappers, React props/state, and the mock backend. The
  unnamed fallback is now "Untitled playlist". Uses of "service" that mean an actual church service
  were left as-is.
  - **The DB migration was edited in place, not added to.** Migration 4 now creates
    `playlists`/`playlist_items` (column `playlist`, index `playlist_items_playlist`) instead of
    `services`/`service_items`. That's safe only because migration 4 has never shipped. No release
    includes it, and the branch was never pushed. The one existing v4 database (the developer's own
    `~/.local/share/com.jxyeverfight.bibleapp/user.db`) was converted by hand with `ALTER TABLE ...
    RENAME`, with a backup at `user.db.bak-before-playlist-rename`. **After this branch is released,
    never edit migration 4 again. Add a new migration instead.**

Nothing is uncommitted.

**Not yet done / open items:**
- Manual multi-monitor QA has not been performed (only headless-Chromium and a real single-monitor
  Tauri run were tested) — see the Verification section below for the exact checklist.
- Push to origin, then cut a release (after which migration 4 is frozen — see above).

(The file-by-file notes below were written before the internal rename, so they still use the old
`Service`/`services.rs` names.)

## Why this redesign happened

The first version (commit `96d0bdb`) put a "Present" button in the per-verse selection toolbar and
opened a modal dialog with a "Service" tab and a "Live" tab; on a single monitor it fullscreened the
*main* window itself as a fallback. After trying it, the ask was for something closer to real
presentation software (PowerPoint/ProPresenter/Google Slides Presenter View):

1. Remove the "Present" button from the per-verse selection toolbar — the only entry point is the
   topbar "Present" button (next to Plans/Library/Search/Settings).
2. Clicking it makes the app **enter presentation mode** as a persistent state, not a dialog.
3. A **real, separate OS window always pops up** — the audience-facing output. The main window is
   never taken over, even with only one display.
4. The **main window becomes a "control center"**: the reader stays fully usable (for picking
   passages), plus a **persistent side dock** with the saved/queued playlist and a **live preview**
   ("just like Canva's presenter view") of exactly what's projected, with Next/Previous/Blank.
5. Passage selection reuses the existing click/shift-click verse selection (resolved via a
   clarifying question); while presenting, the floating selection toolbar swaps its normal actions
   (highlight/note/bookmark/share/copy/cross-refs) for **"Present now"** and **"Add to playlist"**.

`services.rs`, the `user.db` migration, and `presentation.ts`'s slide-building logic
(`buildSlides`/`buildQueueSlides`) were **not** touched by this redesign — only the window-lifecycle
model (no more "fullscreen the main window" fallback) and the main-window UI (a persistent dock
replaces the modal panel).

## What changed, file by file

**`src-tauri/src/present.rs`** — collapsed the three-state `PresentStatus`
(`Window | Inline | Closed`) to:
```rust
pub struct PresentStatus { pub open: bool, pub monitor_label: Option<String> }
```
`present_open` now *always* ensures the `"presentation"` window exists (creating it if absent) and
either fullscreens it on an external monitor (via the existing, unit-tested `choose_external`) or
releases it to an ordinary, decorated, resizable window (`960×540` default) for the operator to
place themselves — `main` is never fullscreened by this feature anymore. `present_close` only
closes the presentation window. The `CloseRequested` → `"present://closed"` emit to `main` is kept.
`choose_external`'s four unit tests are untouched.

**`src/api.ts`** — `PresentStatus` mirrors the new Rust shape; added an exported
`toNewServiceItem(item: ServiceItem): NewServiceItem` helper (was a private `itemToNew` inside the
old modal component; now shared).

**`src/PresentationView.tsx`** — measures its own container via `ResizeObserver` instead of
`window.innerWidth`/`innerHeight`, so the same component works both full-bleed (the dedicated
window) and small (the dock's live preview) with correct proportions in both. Font sizes for the
caption/reference/standby text are now computed from the container width in JS (they used to be
fixed `rem`/`vh` values, which looked fine full-screen but would have overflowed a small preview).

**`src/Presentation.tsx`** — wraps `<PresentationView>` in a new full-bleed `.present-window` div;
otherwise unchanged (still does the `present:ready`/`present:state` event handshake).

**`src/App.tsx`**:
- `presenting` is derived from `liveStatus.open`, not separate state.
- Removed: the old full-screen "inline" overlay render, the keyboard-takeover block that used to
  intercept Arrow/Space/B/Escape when inline-presenting (deleting it means chapter navigation and
  the verse cursor keep working unconditionally while presenting — needed for passage selection),
  the `"present"` modal `Panel` value, `openPresenter`.
- Added `togglePresenting()` wired to the topbar button (toggles `presentOpen`/`presentClose`).
- `presentNow()` no longer auto-starts presenting — it only builds ad-hoc slides, and is only
  reachable (from `SelectionBar` and the `G` key) once presentation mode is already on.
- Added `addPendingToService()` for `SelectionBar`'s "Add to playlist" button.
- `G` is now gated on `presenting` in the keyboard handler.
- Topbar "Present" button is a toggle (`aria-pressed`, active-state styling).
- Renders `<PresentationDock>` (wrapped in `inert={overlayOpen}`, so a real modal opened on top —
  Settings, Library, etc. — still traps focus correctly) whenever `presenting` is true.
- `<main className="page">` and the topbar get a `--dock-open` modifier class while presenting, so
  the reader reflows away from the dock instead of running under it.

**`src/SelectionBar.tsx`** — dropped the old `onPresent` prop; added `presenting`, `onPresentNow`,
`onAddToService` (`null` when there's no active playlist to add to). While `presenting` is true,
renders only "Present now" / "Add to playlist" instead of the highlight/note/bookmark/share/refs set.

**`src/Presenter.tsx` → `src/PresentationDock.tsx`** (renamed, and the export renamed
`Presenter` → `PresentationDock`) — no longer a modal: dropped `useReturnFocus`/`useKeepFocus`, the
`.scrim` wrapper, `role="dialog"`, the Escape/Arrow/B key handler, `onClose`, and the "Start
presenting" button (the dock only ever mounts while already presenting). The live preview is now a
real embedded `<PresentationView>` in a `.pres-preview-frame` (16:9 box) instead of plain text — the
literal Canva-presenter-view ask. Sections reordered so **Live** (status, preview, Prev/Next/Blank,
the two toggle buttons, Stop/Redetect) comes before **Playlist** (picker, rename/delete/create, item
list) since Live is what's touched constantly during a service.

**CSS (`src/App.css`)** — new `.pres-dock` (fixed right sidebar, `z-index: 15`, below `.scrim`'s 20
so a real modal still covers it), `.page--dock-open`/`.topbar--dock-open` (reflow, not overlay),
`.pres-preview-frame` (bounded 16:9 box), `.present-window` (full-bleed wrapper for the dedicated
window). `.present-view` dropped its own `position: fixed`/`z-index` (each consumer sizes it now).
Deleted the dead modal `.presenter` rule and the old plain-text `.pres-preview*` rules. Fixed
`.pres-row button[aria-pressed="true"]` (previously written as `.pres-group button[...]`, a class
nothing used, so pressed buttons like "Blank screen" never actually highlighted).

**`src/Settings.tsx`** — removed the `← → B` "while presenting" shortcut row (those are dock-button-
only now, no global keys); reworded the `G` row.

**`scripts/ui/mock-backend.mjs`** and **`scripts/ui/harness.mjs`** — updated the mock
`present_open`/`present_close`/`present_status` to the `{open, monitorLabel}` shape; the harness's
fake `window.__TAURI_INTERNALS__` bridge gained `metadata.currentWindow.label` and
`transformCallback`, and `plugin:event|listen/unlisten/emit/emit_to` are stubbed inert (there's only
ever one page standing in for `main` in headless Chromium; the dock's live preview is driven by
React props, not the event bridge, so it's still fully exercised by `npm run test:ui`).

## Verification already done

- `cargo test` in `src-tauri/`: 73 passed (includes `choose_external`'s four tests, untouched).
- `npm test`: 123 passed.
- `npm run test:ui` (headless Chromium): 109 passed, no regressions from the harness/mock changes.
- `npx tsc --noEmit`: clean under `strict`/`noUnusedLocals`/`noUnusedParameters`.
- Manual verification via the project's own `scripts/ui/harness.mjs` (screenshots): confirmed the
  topbar toggle, the dock appearing/disappearing, the reader reflowing correctly, the selection bar
  swapping action sets while presenting, the dock's live preview actually rendering the current
  slide, playlist create/add/reorder, and the Dark/Light and verse/whole toggle buttons.
- Ran the real Tauri desktop app (`npm run tauri dev`) on this single-monitor machine and confirmed
  it launches cleanly with no console/runtime errors.

## Still needs manual QA (cannot be done in this environment — no second display)

- Plug in a second monitor and confirm `present_open` fullscreens the dedicated window there, and
  that `Redetect display`/`Stop` behave correctly.
- Confirm the single-monitor fallback produces a movable/resizable window rather than commandeering
  `main` (this is the behavior that replaced the old "inline" full-window takeover).
- Confirm the `"present://closed"` OS-close path (closing the projection window from the window
  manager) flips the dock's status correctly and resets any ad-hoc slide.
- Unplug the external monitor mid-session and press "Redetect display" to confirm it falls back
  gracefully.
