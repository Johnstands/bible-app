import { useEffect, useRef, useState } from "react";
import { useReturnFocus } from "./useReturnFocus";
import { shortcutLabel } from "./platform";

export interface NoteDraft {
  book: number;
  chapter: number;
  verse: number;
  verseEnd: number | null;
  /** "John 3:16–18" */
  label: string;
  /** The verse text, shown above the box for context. */
  quote: string;
  /** The saved note being edited, if there is one. */
  id: number | null;
  body: string;
}

interface Props {
  draft: NoteDraft;
  onSave: (body: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NoteEditor({ draft, onSave, onDelete, onClose }: Props) {
  const [body, setBody] = useState(draft.body);
  const ref = useRef<HTMLTextAreaElement>(null);

  useReturnFocus();

  useEffect(() => {
    const box = ref.current;
    box?.focus();
    box?.setSelectionRange(box.value.length, box.value.length);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave(body);
    }
  };

  const changed = body.trim() !== draft.body.trim();
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        className="goto note"
        role="dialog"
        aria-modal="true"
        aria-label={`Note on ${draft.label}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="note-head">
          <span className="note-ref">{draft.label}</span>
          <p className="note-quote">{draft.quote}</p>
        </div>
        <textarea
          ref={ref}
          className="note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Write a note…"
          aria-label="Note"
        />
        <div className="goto-footer note-footer">
          {draft.id !== null ? (
            <button className="note-delete" onClick={onDelete}>
              Delete note
            </button>
          ) : (
            <span>{shortcutLabel("Enter")} to save</span>
          )}
          <span className="note-actions">
            <button onClick={onClose}>Cancel</button>
            <button className="note-save" disabled={!body.trim() || !changed} onClick={() => onSave(body)}>
              Save
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
