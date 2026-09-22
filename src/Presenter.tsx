import { useRef, useState } from "react";
import type { NewServiceItem, PresentStatus, Service, ServiceItem } from "./api";
import { GRANULARITIES, GRANULARITY_LABELS, PRESENT_THEMES, PRESENT_THEMES_LIST } from "./presentation";
import type { Granularity, PresentSlide, PresentTheme } from "./presentation";
import { referenceLabel } from "./verses";
import { useKeepFocus } from "./useKeepFocus";
import { useReturnFocus } from "./useReturnFocus";

interface Props {
  services: Service[];
  activeServiceId: number | null;
  onSelectService: (id: number | null) => void;
  onCreateService: (name: string) => void;
  onRenameService: (id: number, name: string) => void;
  onDeleteService: (id: number) => void;
  onSaveItems: (id: number, items: NewServiceItem[]) => void;
  titleOf: (book: number) => string;
  /** The reader's current selection, ready to add to the service; null when nothing is selected. */
  pendingItem: NewServiceItem | null;
  pendingItemLabel: string | null;

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
  onStart: () => void;
  onStop: () => void;
  onRedetect: () => void;

  onClose: () => void;
}

const itemToNew = (i: ServiceItem): NewServiceItem => ({ book: i.book, chapter: i.chapter, verse: i.verse, verseEnd: i.verseEnd, label: i.label });

/** The control panel for church presentation mode: build a service's list of passages ahead of time,
 *  and drive what's live on the projected screen. */
export function Presenter({
  services, activeServiceId, onSelectService, onCreateService, onRenameService, onDeleteService, onSaveItems,
  titleOf, pendingItem, pendingItemLabel,
  slide, slideIndex, slideCount, usingAdHoc, onReturnToService, onNext, onPrev,
  blank, onToggleBlank, granularity, onGranularity, theme, onTheme,
  status, onStart, onStop, onRedetect,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);

  useReturnFocus();
  useKeepFocus(panelRef);

  const active = services.find((s) => s.id === activeServiceId) ?? null;

  const itemLabel = (item: ServiceItem) => {
    const end = item.verseEnd ?? item.verse;
    const verses = Array.from({ length: end - item.verse + 1 }, (_, i) => item.verse + i);
    return item.label || referenceLabel(titleOf(item.book), item.chapter, verses);
  };

  const addItem = () => {
    if (!active || !pendingItem) return;
    onSaveItems(active.id, [...active.items.map(itemToNew), pendingItem]);
  };
  const removeItem = (i: number) => {
    if (!active) return;
    onSaveItems(active.id, active.items.filter((_, j) => j !== i).map(itemToNew));
  };
  const moveItem = (i: number, dir: 1 | -1) => {
    if (!active) return;
    const j = i + dir;
    if (j < 0 || j >= active.items.length) return;
    const next = [...active.items];
    [next[i], next[j]] = [next[j], next[i]];
    onSaveItems(active.id, next.map(itemToNew));
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

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const typing = e.target instanceof HTMLElement && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT");
    if (typing) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      onNext();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      onPrev();
    } else if (e.key === "b" || e.key === "B") {
      e.preventDefault();
      onToggleBlank();
    }
  };

  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto presenter"
        role="dialog"
        aria-modal="true"
        aria-label="Presentation"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="plans-head">
          <h2 className="plans-title">Presentation</h2>
        </div>

        <div className="plans-body pres-body">
          <section aria-label="Service" className="pres-section">
            <h3 className="plans-subhead">Service</h3>
            <div className="pres-row">
              <select aria-label="Active service" value={activeServiceId ?? ""} onChange={(e) => onSelectService(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Choose a service…</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {active && renaming === null && <button onClick={() => setRenaming(active.name)}>Rename</button>}
              {active && <button className="pres-danger" onClick={() => onDeleteService(active.id)}>Delete</button>}
            </div>

            {active && renaming !== null && (
              <form className="pres-row" onSubmit={saveRename}>
                <input aria-label="Service name" autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} />
                <button type="submit">Save</button>
                <button type="button" onClick={() => setRenaming(null)}>
                  Cancel
                </button>
              </form>
            )}

            <form className="pres-row" onSubmit={createService}>
              <input aria-label="New service name" placeholder="New service name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button type="submit">Create</button>
            </form>

            {active ? (
              <>
                {active.items.length === 0 ? (
                  <p className="goto-empty">No passages yet. Select verses in the reader, then add them below.</p>
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
                )}
                <button className="set-link" disabled={!pendingItem} onClick={addItem}>
                  {pendingItemLabel ? `Add ${pendingItemLabel}` : "Select verses in the reader to add them"}
                </button>
              </>
            ) : (
              <p className="goto-empty">Choose or create a service to build its list.</p>
            )}
          </section>

          <section aria-label="Live" className="pres-section">
            <h3 className="plans-subhead">Live</h3>

            {status.mode === "closed" ? (
              <button className="plan-read" onClick={onStart}>
                Start presenting
              </button>
            ) : (
              <div className="pres-row">
                <span className="pres-live-status" role="status">
                  {status.mode === "window" ? `Presenting to ${status.monitorLabel ?? "the second display"}` : "Presenting on this screen"}
                </span>
                <button onClick={onRedetect}>Redetect display</button>
                <button className="pres-danger" onClick={onStop}>
                  Stop
                </button>
              </div>
            )}

            <div className="pres-preview" data-empty={!slide || undefined}>
              {slide ? (
                <>
                  <p className="pres-preview-ref">
                    {slide.reference}
                    {slideCount > 1 ? ` · ${slideIndex + 1} of ${slideCount}` : ""}
                  </p>
                  <p className="pres-preview-text">{slide.text}</p>
                </>
              ) : (
                <p className="pres-preview-ref">Nothing on screen yet</p>
              )}
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
                Return to the service
              </button>
            )}

            <div className="pres-row" role="group" aria-label="Slides">
              {GRANULARITIES.map((g) => (
                <button key={g} aria-pressed={granularity === g} onClick={() => onGranularity(g)}>
                  {GRANULARITY_LABELS[g]}
                </button>
              ))}
            </div>
            <div className="pres-row" role="group" aria-label="Screen color">
              {PRESENT_THEMES_LIST.map((t) => (
                <button key={t} aria-pressed={theme === t} onClick={() => onTheme(t)}>
                  {PRESENT_THEMES[t].label}
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="goto-footer">
          <span>← → step · B blank</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
