import { useState } from "react";
import type { NewPlaylistItem, PresentStatus, Playlist, PlaylistItem } from "./api";
import { slideSrc, toNewPlaylistItem } from "./api";
import { GRANULARITY_LABELS, PRESENT_THEMES, slideCaption } from "./presentation";
import type { Granularity, ItemSpan, PresentationState, PresentSlide, PresentTheme } from "./presentation";
import { PresentationView } from "./PresentationView";
import { referenceLabel } from "./verses";

interface Props {
  playlists: Playlist[];
  activePlaylistId: number | null;
  onSelectPlaylist: (id: number | null) => void;
  onCreatePlaylist: (name: string) => void;
  onRenamePlaylist: (id: number, name: string) => void;
  onDeletePlaylist: (id: number) => void;
  onSaveItems: (id: number, items: NewPlaylistItem[]) => void;
  titleOf: (book: number) => string;

  presentState: PresentationState;
  slide: PresentSlide | null;
  slideIndex: number;
  slideCount: number;
  usingAdHoc: boolean;
  /** What returning from an ad-hoc passage goes back to, e.g. "Songs.png · 3 of 5". */
  returnLabel: string | null;
  onReturnToPlaylist: () => void;
  /** Where each playlist item's slides sit in the queue, in item order. */
  itemSpans: ItemSpan[];
  /** The item on screen (-1 for none, or an ad-hoc passage), and its slide's queue index. */
  liveItem: number;
  liveSlide: number;
  onJumpToItem: (i: number) => void;
  onJumpToSlide: (queueIndex: number) => void;
  importing: boolean;
  onAddSlides: () => void;
  onNext: () => void;
  onPrev: () => void;

  blank: boolean;
  onToggleBlank: () => void;
  granularity: Granularity;
  onGranularity: (g: Granularity) => void;
  theme: PresentTheme;
  onTheme: (t: PresentTheme) => void;

  status: PresentStatus;
  onStop: () => void;
  onRedetect: () => void;
}

/**
 * The control center's persistent side dock, visible for as long as presentation mode is on: the
 * saved playlist (the "predefined presentation" built ahead of time) and a live, Canva-style preview
 * of exactly what's on the projected screen right now, with the controls to drive it. Not a modal —
 * the reader stays fully interactive behind it, since that's how passages get selected to present.
 */
export function PresentationDock({
  playlists, activePlaylistId, onSelectPlaylist, onCreatePlaylist, onRenamePlaylist, onDeletePlaylist, onSaveItems,
  titleOf,
  presentState, slide, slideIndex, slideCount, usingAdHoc, returnLabel, onReturnToPlaylist,
  itemSpans, liveItem, liveSlide, onJumpToItem, onJumpToSlide, importing, onAddSlides, onNext, onPrev,
  blank, onToggleBlank, granularity, onGranularity, theme, onTheme,
  status, onStop, onRedetect,
}: Props) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Deck items (by item id) whose slide strip is open; the live deck's is always open. */
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const active = playlists.find((s) => s.id === activePlaylistId) ?? null;

  const itemLabel = (item: PlaylistItem) => {
    if (item.kind === "deck") return item.label || item.name;
    const end = item.verseEnd ?? item.verse;
    const verses = Array.from({ length: end - item.verse + 1 }, (_, i) => item.verse + i);
    return item.label || referenceLabel(titleOf(item.book), item.chapter, verses);
  };

  const removeItem = (i: number) => {
    if (!active) return;
    onSaveItems(active.id, active.items.filter((_, j) => j !== i).map(toNewPlaylistItem));
  };
  const moveItem = (i: number, dir: 1 | -1) => {
    if (!active) return;
    const j = i + dir;
    if (j < 0 || j >= active.items.length) return;
    const next = [...active.items];
    [next[i], next[j]] = [next[j], next[i]];
    onSaveItems(active.id, next.map(toNewPlaylistItem));
  };

  const createPlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) onCreatePlaylist(newName);
    setNewName("");
  };
  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (active && renaming !== null) onRenamePlaylist(active.id, renaming);
    setRenaming(null);
  };

  return (
    <aside className="pres-dock" aria-label="Presentation control center">
      <div className="plans-head">
        <h2 className="plans-title">Presentation</h2>
      </div>

      <div className="pres-body">
        <section aria-label="Live" className="pres-section">
          <h3 className="plans-subhead">Live</h3>

          <div className="pres-row">
            <span className="pres-live-status" role="status">
              {status.monitorLabel
                ? `Presenting to ${status.monitorLabel}`
                : "Presenting — move the output window to a display, or press Redetect once one's connected"}
            </span>
          </div>
          <div className="pres-row">
            <button onClick={onRedetect}>Redetect display</button>
            <button className="pres-danger" onClick={onStop}>
              Stop presenting
            </button>
          </div>

          <div className="pres-preview-wrap">
            <p className="pres-preview-meta">
              {slide
                ? slide.kind === "image"
                  ? slideCaption(slide)
                  : `${slide.reference}${slideCount > 1 ? ` · ${slideIndex + 1} of ${slideCount}` : ""}`
                : "Nothing on screen yet"}
            </p>
            <div className="pres-preview-frame">
              <PresentationView state={presentState} />
            </div>
          </div>

          <div className="pres-row" role="group" aria-label="Live controls">
            <button onClick={onPrev} disabled={slideIndex <= 0}>
              ◀ Previous
            </button>
            <button onClick={onNext} disabled={slideIndex >= slideCount - 1}>
              Next ▶
            </button>
            <button aria-pressed={blank} onClick={onToggleBlank}>
              {blank ? "Unblank" : "Blank screen"}
            </button>
          </div>
          {usingAdHoc && (
            <button className="set-link" onClick={onReturnToPlaylist}>
              {returnLabel ? `Back to ${returnLabel}` : "Return to the playlist"}
            </button>
          )}

          <div className="pres-row">
            <button
              aria-label={`Slides: ${GRANULARITY_LABELS[granularity]}. Click to switch.`}
              title="Toggle how a multi-verse passage is presented"
              onClick={() => onGranularity(granularity === "verse" ? "whole" : "verse")}
            >
              {GRANULARITY_LABELS[granularity]}
            </button>
            <button
              aria-label={`Screen color: ${PRESENT_THEMES[theme].label}. Click to switch.`}
              title="Toggle the projected screen's color"
              onClick={() => onTheme(theme === "dark" ? "light" : "dark")}
            >
              {PRESENT_THEMES[theme].label}
            </button>
          </div>
        </section>

        <section aria-label="Playlist" className="pres-section">
          <h3 className="plans-subhead">Playlist</h3>
          <div className="pres-row">
            <select aria-label="Active playlist" value={activePlaylistId ?? ""} onChange={(e) => onSelectPlaylist(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose a playlist…</option>
              {playlists.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {active && renaming === null && <button onClick={() => setRenaming(active.name)}>Rename</button>}
            {active && (
              <button className="pres-danger" onClick={() => onDeletePlaylist(active.id)}>
                Delete
              </button>
            )}
          </div>

          {active && renaming !== null && (
            <form className="pres-row" onSubmit={saveRename}>
              <input aria-label="Playlist name" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
              <button type="submit">Save</button>
              <button type="button" onClick={() => setRenaming(null)}>
                Cancel
              </button>
            </form>
          )}

          <form className="pres-row" onSubmit={createPlaylist}>
            <input aria-label="New playlist name" placeholder="New playlist name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit">Create</button>
          </form>

          {active ? (
            active.items.length === 0 ? (
              <p className="goto-empty">
                Nothing here yet. Select verses in the reader, then choose "Add to playlist" there, or add slides below.
              </p>
            ) : (
              <ol className="pres-items">
                {active.items.map((item, i) => {
                  const span = itemSpans[i];
                  const live = i === liveItem;
                  const open = item.kind === "deck" && (live || expanded.has(item.id));
                  return (
                    <li key={item.id} className="pres-item" data-live={live || undefined}>
                      <div className="pres-item-row">
                        <button
                          className="pres-item-go"
                          aria-current={live || undefined}
                          disabled={!span || span.count === 0}
                          title={live ? "On screen now" : "Show this now"}
                          onClick={() => onJumpToItem(i)}
                        >
                          {item.kind === "deck" && <img className="pres-thumb" src={slideSrc(item.deck, 0)} alt="" />}
                          <span className="pres-item-ref">{itemLabel(item)}</span>
                          {item.kind === "deck" && <span className="pres-item-count">{item.slideCount === 1 ? "1 slide" : `${item.slideCount} slides`}</span>}
                        </button>
                        <span className="pres-item-actions">
                          {item.kind === "deck" && item.slideCount > 1 && !live && (
                            <button aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} the slides in ${itemLabel(item)}`} onClick={() => toggleExpanded(item.id)}>
                              {open ? "▴" : "▾"}
                            </button>
                          )}
                          <button aria-label="Move up" disabled={i === 0} onClick={() => moveItem(i, -1)}>
                            ↑
                          </button>
                          <button aria-label="Move down" disabled={i === active.items.length - 1} onClick={() => moveItem(i, 1)}>
                            ↓
                          </button>
                          <button aria-label={`Remove ${itemLabel(item)}`} onClick={() => removeItem(i)}>
                            ×
                          </button>
                        </span>
                      </div>
                      {open && span && item.slideCount > 1 && (
                        <ol className="pres-strip" aria-label={`Slides in ${itemLabel(item)}`}>
                          {Array.from({ length: span.count }, (_, j) => (
                            <li key={j}>
                              <button
                                className="pres-strip-slide"
                                aria-current={span.start + j === liveSlide || undefined}
                                aria-label={`Show slide ${j + 1} of ${span.count}`}
                                onClick={() => onJumpToSlide(span.start + j)}
                              >
                                <img src={slideSrc(item.deck, j)} alt="" loading="lazy" />
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  );
                })}
              </ol>
            )
          ) : (
            <p className="goto-empty">Choose or create a playlist to build it.</p>
          )}

          {active && (
            <>
              <div className="pres-row">
                <button onClick={onAddSlides} disabled={importing}>
                  {importing ? "Adding slides…" : "Add slides…"}
                </button>
              </div>
              <p className="pres-hint">
                Pictures (PNG or JPG). Choose several at once to add them as one set, in filename order. Export a PowerPoint as
                pictures first; animations and videos don’t carry over.
              </p>
            </>
          )}
        </section>
      </div>
    </aside>
  );
}
