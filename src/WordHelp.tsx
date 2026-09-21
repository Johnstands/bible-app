import { useId, useLayoutEffect, useRef, useState } from "react";
import { KIND_LABELS } from "./glossary";
import type { GlossaryEntry } from "./glossary";

interface Props {
  entry: GlossaryEntry;
  /** The word as it appears in the verse. */
  word: string;
  /** The underlined word that was clicked. */
  anchor: HTMLElement;
  onClose: () => void;
}

const MARGIN = 12; // keep this far from the window edge
const GAP = 8; // space between the word and the popover
const SCROLL_GRACE_MS = 300;

/** A small card next to an underlined word: what it meant in the KJV and, for false friends, what it means now. */
export function WordHelp({ entry, word, anchor, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);

  // The underlined word is described by the card while it is open.
  useLayoutEffect(() => {
    anchor.setAttribute("aria-describedby", id);
    return () => anchor.removeAttribute("aria-describedby");
  }, [anchor, id]);

  // Place it under the word (over it if there is no room), kept inside the window.
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    // A phrase can wrap; anchor to the line the click was on, which is the first one that is still on screen.
    const rect = anchor.getClientRects()[0] ?? anchor.getBoundingClientRect();
    const { width, height } = card.getBoundingClientRect();
    const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN);
    const below = rect.bottom + GAP;
    const top = below + height + MARGIN > window.innerHeight ? Math.max(MARGIN, rect.top - height - GAP) : below;
    setPlace({ left, top });
  }, [anchor, entry]);

  // Anything that moves the page, or a click elsewhere, puts the card away. Scrolling is ignored for a
  // moment after it opens, because a touchpad's momentum or a scroll-into-view can end right at the click.
  useLayoutEffect(() => {
    const openedAt = performance.now();
    const onScroll = () => {
      if (performance.now() - openedAt > SCROLL_GRACE_MS) onClose();
    };
    const away = (e: Event) => {
      const target = e.target as Node | null;
      if (target && (ref.current?.contains(target) || (target instanceof Element && target.closest(".kjv-word")))) return;
      onClose();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("mousedown", away);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("mousedown", away);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      id={id}
      className="wordhelp"
      role="tooltip"
      data-kind={entry.kind}
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
    >
      <div className="wh-head">
        <span className="wh-word">{word}</span>
        <span className="wh-kind">{KIND_LABELS[entry.kind]}</span>
      </div>
      <p className="wh-meaning">
        {entry.kind === "changed" && <span className="wh-label">In the KJV</span>}
        {entry.meaning}
      </p>
      {entry.today && (
        <p className="wh-today">
          <span className="wh-label">Today</span>
          {entry.today}
        </p>
      )}
    </div>
  );
}
