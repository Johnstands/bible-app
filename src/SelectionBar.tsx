import { HIGHLIGHT_COLORS } from "./api";
import type { HighlightColor } from "./api";

interface Props {
  /** "John 3:16–18" */
  label: string;
  /** The color shared by every selected verse, if they all have the same one. */
  color: HighlightColor | null;
  hasNote: boolean;
  bookmarked: boolean;
  copied: boolean;
  onColor: (color: HighlightColor) => void;
  onNote: () => void;
  onBookmark: () => void;
  onCopy: () => void;
  onClear: () => void;
}

/** The toolbar that appears over the reading page while verses are selected. */
export function SelectionBar({ label, color, hasNote, bookmarked, copied, onColor, onNote, onBookmark, onCopy, onClear }: Props) {
  return (
    <div className="selbar" role="toolbar" aria-label={`Actions for ${label}`} onMouseDown={(e) => e.preventDefault()}>
      <span className="selbar-label">{label}</span>
      <span className="selbar-rule" aria-hidden="true" />
      <div className="selbar-colors" role="group" aria-label="Highlight color">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            className="dot"
            data-color={c}
            aria-pressed={color === c}
            aria-label={color === c ? `Remove ${c} highlight` : `Highlight ${c}`}
            title={color === c ? "Remove highlight" : `Highlight ${c}`}
            onClick={() => onColor(c)}
          />
        ))}
      </div>
      <span className="selbar-rule" aria-hidden="true" />
      <button className="selbar-action" onClick={onNote}>
        {hasNote ? "Edit note" : "Note"}
      </button>
      <button className="selbar-action" onClick={onBookmark}>
        {bookmarked ? "Unbookmark" : "Bookmark"}
      </button>
      <button className="selbar-action" onClick={onCopy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <button className="selbar-action selbar-close" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)">
        ×
      </button>
    </div>
  );
}
