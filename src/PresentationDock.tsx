import { useState } from "react";
import type { NewServiceItem, PresentStatus, Service, ServiceItem } from "./api";
import { toNewServiceItem } from "./api";
import { GRANULARITY_LABELS, PRESENT_THEMES } from "./presentation";
import type { Granularity, PresentationState, PresentSlide, PresentTheme } from "./presentation";
import { PresentationView } from "./PresentationView";
import { referenceLabel } from "./verses";

interface Props {
  services: Service[];
  activeServiceId: number | null;
  onSelectService: (id: number | null) => void;
  onCreateService: (name: string) => void;
  onRenameService: (id: number, name: string) => void;
  onDeleteService: (id: number) => void;
  onSaveItems: (id: number, items: NewServiceItem[]) => void;
  titleOf: (book: number) => string;

  presentState: PresentationState;
  slide: PresentSlide | null;
  slideIndex: number;
  slideCount: number;
  usingAdHoc: boolean;
  onReturnToService: () => void;
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
  services, activeServiceId, onSelectService, onCreateService, onRenameService, onDeleteService, onSaveItems,
  titleOf,
  presentState, slide, slideIndex, slideCount, usingAdHoc, onReturnToService, onNext, onPrev,
  blank, onToggleBlank, granularity, onGranularity, theme, onTheme,
  status, onStop, onRedetect,
}: Props) {
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  const active = services.find((s) => s.id === activeServiceId) ?? null;

  const itemLabel = (item: ServiceItem) => {
    const end = item.verseEnd ?? item.verse;
    const verses = Array.from({ length: end - item.verse + 1 }, (_, i) => item.verse + i);
    return item.label || referenceLabel(titleOf(item.book), item.chapter, verses);
  };

  const removeItem = (i: number) => {
    if (!active) return;
    onSaveItems(active.id, active.items.filter((_, j) => j !== i).map(toNewServiceItem));
  };
  const moveItem = (i: number, dir: 1 | -1) => {
    if (!active) return;
    const j = i + dir;
    if (j < 0 || j >= active.items.length) return;
    const next = [...active.items];
    [next[i], next[j]] = [next[j], next[i]];
    onSaveItems(active.id, next.map(toNewServiceItem));
  };

  const createService = (e: React.FormEvent) => {
    e.preventDefault();
    if (newName.trim()) onCreateService(newName);
    setNewName("");
  };
  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (active && renaming !== null) onRenameService(active.id, renaming);
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
              {slide ? `${slide.reference}${slideCount > 1 ? ` · ${slideIndex + 1} of ${slideCount}` : ""}` : "Nothing on screen yet"}
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
            <button className="set-link" onClick={onReturnToService}>
              Return to the playlist
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
            <select aria-label="Active playlist" value={activeServiceId ?? ""} onChange={(e) => onSelectService(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose a playlist…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {active && renaming === null && <button onClick={() => setRenaming(active.name)}>Rename</button>}
            {active && (
              <button className="pres-danger" onClick={() => onDeleteService(active.id)}>
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

          <form className="pres-row" onSubmit={createService}>
            <input aria-label="New playlist name" placeholder="New playlist name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit">Create</button>
          </form>

          {active ? (
            active.items.length === 0 ? (
              <p className="goto-empty">No passages yet. Select verses in the reader, then choose "Add to playlist" there.</p>
            ) : (
              <ol className="pres-items">
                {active.items.map((item, i) => (
                  <li key={item.id} className="pres-item">
                    <span className="pres-item-ref">{itemLabel(item)}</span>
                    <span className="pres-item-actions">
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
                  </li>
                ))}
              </ol>
            )
          ) : (
            <p className="goto-empty">Choose or create a playlist to build it.</p>
          )}
        </section>
      </div>
    </aside>
  );
}
