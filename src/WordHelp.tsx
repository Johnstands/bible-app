import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { getStrongs } from "./api";
import type { StrongsEntry } from "./api";
import { KIND_LABELS } from "./glossary";
import type { WordTarget } from "./wordUnits";

interface Props {
  target: WordTarget;
  /** The underlined word that was clicked. */
  anchor: HTMLElement;
  onClose: () => void;
  /** Lists every verse that uses a Strong's number. */
  onSearchNumber: (num: string) => void;
}

const MARGIN = 12; // keep this far from the window edge
const GAP = 8; // space between the word and the popover
const SCROLL_GRACE_MS = 300;

const languageOf = (num: string) => (num.startsWith("H") ? "Hebrew" : "Greek");

/** Strong's entries mention other words by number ("from G1537 (ἐκ)"); those become links. */
function withLinks(text: string, open: (num: string) => void): React.ReactNode[] {
  return text.split(/\b([GH]\d{1,4})\b/).map((part, i) =>
    i % 2 === 0 ? (
      part
    ) : (
      <button key={i} type="button" className="wh-ref" onClick={() => open(part)}>
        {part}
      </button>
    ),
  );
}

/** The Hebrew or Greek word behind an English one: its letters, how it sounds, what Strong's says, and how the KJV renders it. */
function OriginalWord({
  num, onOpen, onSearch, onBack,
}: {
  num: string;
  onOpen: (num: string) => void;
  onSearch: (num: string) => void;
  onBack: (() => void) | null;
}) {
  // `undefined` while it loads, `null` when the dictionary has no such number.
  const [entry, setEntry] = useState<StrongsEntry | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setEntry(undefined);
    getStrongs(num)
      .then((e) => live && setEntry(e))
      .catch(() => live && setEntry(null));
    return () => {
      live = false;
    };
  }, [num]);

  const hebrew = num.startsWith("H");
  return (
    <section className="wh-original" aria-label={`${languageOf(num)} word ${num}`}>
      <p className="wh-label-row">
        <span className="wh-label">
          {languageOf(num)} · {num}
        </span>
        {onBack && (
          <button type="button" className="wh-back" onClick={onBack}>
            ← Back
          </button>
        )}
      </p>
      {entry === undefined && <p className="wh-note">Looking it up…</p>}
      {entry === null && <p className="wh-note">Strong's dictionary has no entry for {num}.</p>}
      {entry && (
        <>
          <p className="wh-lemma-row">
            <span className="wh-lemma" lang={hebrew ? "he" : "grc"} dir={hebrew ? "rtl" : "ltr"}>
              {entry.lemma}
            </span>
            <span className="wh-translit">
              {entry.translit}
              {entry.pron ? ` · ${entry.pron}` : ""}
            </span>
          </p>
          <p className="wh-def">{withLinks(entry.def, onOpen)}</p>
          {entry.renderings.length > 0 && (
            <p className="wh-renders">
              <span className="wh-label">The KJV renders it</span>
              {entry.renderings.map((r) => `${r.word} ×${r.count}`).join(" · ")}
            </p>
          )}
          <button type="button" className="wh-search" onClick={() => onSearch(num)}>
            Every verse with this word ({entry.uses.toLocaleString("en-US")}) →
          </button>
        </>
      )}
    </section>
  );
}

/**
 * A small card next to a word in the text. For a glossary word it says what the word meant in the KJV and, for false
 * friends, what it means now; for a word with a Strong's number it also shows the Hebrew or Greek word behind it.
 */
export function WordHelp({ target, anchor, onClose, onSearchNumber }: Props) {
  const { word, entry, nums } = target;
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  // Following a number in a definition shows that entry instead; Back returns, and an empty trail shows the word's own.
  const [trail, setTrail] = useState<string[]>([]);
  useEffect(() => setTrail([]), [target]);
  const shown = trail.length > 0 ? [trail[trail.length - 1]] : (nums ?? []);
  const originalLanguage = nums?.[0] ? languageOf(nums[0]) : null;

  // The underlined word is described by the card while it is open.
  useLayoutEffect(() => {
    anchor.setAttribute("aria-describedby", id);
    return () => anchor.removeAttribute("aria-describedby");
  }, [anchor, id]);

  // Place it under the word (over it if there is no room), kept inside the window, and again whenever its own
  // size changes, as it does when a dictionary entry arrives.
  useLayoutEffect(() => {
    const card = ref.current;
    if (!card) return;
    const position = () => {
      // A phrase can wrap; anchor to the line the click was on, which is the first one that is still on screen.
      const rect = anchor.getClientRects()[0] ?? anchor.getBoundingClientRect();
      const { width, height } = card.getBoundingClientRect();
      const left = Math.min(Math.max(MARGIN, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - MARGIN);
      const below = rect.bottom + GAP;
      const top = below + height + MARGIN > window.innerHeight ? Math.max(MARGIN, rect.top - height - GAP) : below;
      setPlace((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(card);
    return () => observer.disconnect();
  }, [anchor]);

  // Anything that moves the page, or a click elsewhere, puts the card away. Scrolling is ignored for a
  // moment after it opens, because a touchpad's momentum or a scroll-into-view can end right at the click.
  useLayoutEffect(() => {
    const openedAt = performance.now();
    const onScroll = () => {
      if (performance.now() - openedAt > SCROLL_GRACE_MS) onClose();
    };
    const away = (e: Event) => {
      const clicked = e.target as Node | null;
      if (clicked && (ref.current?.contains(clicked) || (clicked instanceof Element && clicked.closest(".kjv-word, .orig-word")))) return;
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
      // A card with buttons in it is a dialog; a plain definition is a tooltip.
      role={shown.length > 0 ? "dialog" : "tooltip"}
      aria-label={shown.length > 0 ? word : undefined}
      data-kind={entry?.kind}
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
    >
      <div className="wh-head">
        <span className="wh-word">{word}</span>
        <span className="wh-kind">{entry ? KIND_LABELS[entry.kind] : originalLanguage}</span>
      </div>
      {entry && (
        <>
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
        </>
      )}
      {shown.map((num) => (
        <OriginalWord
          key={num}
          num={num}
          onOpen={(n) => setTrail((t) => [...t, n])}
          onSearch={onSearchNumber}
          onBack={trail.length > 0 ? () => setTrail((t) => t.slice(0, -1)) : null}
        />
      ))}
    </div>
  );
}
