import { useEffect, useMemo, useRef, useState } from "react";
import { fitText } from "./verseCard";
import { FADE_MS, PRESENT_THEMES, screenKey } from "./presentation";
import type { PresentationState } from "./presentation";

const LINE_HEIGHT = 1.32;
const VERSE_FONT = '500 1px "EB Garamond Variable", "EB Garamond", Georgia, serif';

/** More layers than this at once only happens with frantic clicking; the oldest are dropped. */
const MAX_LAYERS = 4;

interface Props {
  state: PresentationState;
}

interface Box {
  width: number;
  height: number;
}

/** One complete screen, stacked over whatever was shown before it. */
interface Layer {
  id: number;
  key: string;
  state: PresentationState;
  /** Still fading in over the layers below it. */
  fading: boolean;
}

/**
 * Pictures loaded and decoded ahead of use, so a fade never starts on a half-drawn image. Only the
 * last few are kept: a big deck's pictures would otherwise all stay in memory.
 */
const decoded = new Map<string, Promise<void>>();
const DECODED_KEPT = 8;

function whenDecoded(src: string): Promise<void> {
  let ready = decoded.get(src);
  if (!ready) {
    const img = new Image();
    img.src = src;
    // A picture that fails to load, or never answers, mustn't hold the screen up.
    ready = Promise.race([img.decode().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, 1500))]);
    decoded.set(src, ready);
    for (const old of decoded.keys()) {
      if (decoded.size <= DECODED_KEPT) break;
      decoded.delete(old);
    }
  }
  return ready;
}

/**
 * Renders whatever `state` says to show: a blank/black screen, a standby message, the current
 * verse slide's text as large as will fit its container, or an imported slide's picture. Sizes
 * itself entirely from the box it's given (a `ResizeObserver` on its own root, not the window), so
 * the same component works full-bleed as the whole UI of the dedicated presentation window (see
 * PresentationWindow.tsx) and small, as the control center's live preview (see
 * PresentationDock.tsx) — the truest possible preview of what's on screen.
 *
 * Each change of what's shown adds a new layer on top. With the Fade transition it fades in over
 * the old one; both have solid backgrounds, which makes a true crossfade. Once it's fully in, the
 * layers beneath are dropped, so clicking quickly stacks a few briefly and ends on the latest: fades
 * never queue up.
 */
export function PresentationView({ state }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<Box>({ width: 0, height: 0 });
  const key = screenKey(state);
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, key, state, fading: false }]);
  const nextId = useRef(1);
  /** The screen most recently asked for, which may still be waiting for its picture to load. */
  const wanted = useRef(key);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => timers.current.forEach((t) => clearTimeout(t)), []);

  useEffect(() => {
    if (state.preload) void whenDecoded(state.preload);
  }, [state.preload]);

  useEffect(() => {
    if (key === wanted.current) {
      // The same screen, e.g. only the picture to preload changed: keep it, with no transition.
      setLayers((ls) => (ls.some((l) => l.key === key && l.state !== state) ? ls.map((l) => (l.key === key ? { ...l, state } : l)) : ls));
      return;
    }
    wanted.current = key;
    const show = () => {
      // Something newer was asked for while this one's picture loaded.
      if (wanted.current !== key) return;
      const id = nextId.current++;
      if (state.transition !== "fade") {
        setLayers([{ id, key, state, fading: false }]);
        return;
      }
      setLayers((ls) => [...ls.slice(-(MAX_LAYERS - 1)), { id, key, state, fading: true }]);
      const done = window.setTimeout(() => {
        // Fully in: nothing beneath it can be seen any more.
        setLayers((ls) => {
          const at = ls.findIndex((l) => l.id === id);
          return at < 0 ? ls : ls.slice(at).map((l) => (l.id === id ? { ...l, fading: false } : l));
        });
      }, FADE_MS + 50);
      timers.current.push(done);
    };
    const picture = !state.blank && state.slide?.kind === "image" ? state.slide.src : null;
    if (picture) void whenDecoded(picture).then(show);
    else show();
  }, [key, state]);

  return (
    <div ref={wrapRef} className="present-view">
      {layers.map((l, i) => (
        <ScreenLayer key={l.id} state={l.state} box={box} fading={l.fading} current={i === layers.length - 1} />
      ))}
    </div>
  );
}

let measureCanvas: HTMLCanvasElement | null = null;

/** One whole screen: blank, standby, a verse slide fitted to the box, or a picture. */
function ScreenLayer({ state, box, fading, current }: { state: PresentationState; box: Box; fading: boolean; current: boolean }) {
  const theme = PRESENT_THEMES[state.theme];
  const slide = state.slide;
  const verseSlide = slide?.kind === "verse" ? slide : null;
  const padX = Math.round(box.width * 0.08);
  const padY = Math.round(box.height * 0.1);
  const hasCaption = Boolean(verseSlide?.label);
  const captionH = hasCaption ? box.height * 0.07 : 0;
  const refH = box.height * 0.08;
  // Every size below scales with the container (not fixed rem/vh units), so the same component looks
  // right whether it's the full-screen output or a small dock preview — a fixed pixel size would
  // either overflow a tiny preview or look tiny on a real screen.
  const maxSize = Math.round(box.width * 0.055);
  const minSize = Math.min(maxSize, Math.max(6, Math.round(box.width * 0.018)));
  const captionSize = Math.max(9, Math.round(box.width * 0.0125));
  const refSize = Math.max(10, Math.round(box.width * 0.014));

  const fit = useMemo(() => {
    if (!verseSlide || box.width === 0 || box.height === 0) return null;
    const canvas = (measureCanvas ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d")!;
    const measure = (text: string, size: number) => {
      ctx.font = VERSE_FONT.replace("1px", `${size}px`);
      return ctx.measureText(text).width;
    };
    return fitText(
      verseSlide.text,
      { width: box.width - padX * 2, height: box.height - padY * 2 - captionH - refH },
      measure,
      { maxSize, minSize, lineHeight: LINE_HEIGHT },
    );
  }, [verseSlide, box, padX, padY, captionH, refH, maxSize, minSize]);

  return (
    <div
      className={`present-layer${fading ? " present-layer--in" : ""}`}
      // Pictures are letterboxed on black, whatever the verses' Dark/Light setting.
      style={{
        background: state.blank || slide?.kind === "image" ? "#000" : theme.bg,
        color: theme.ink,
        animationDuration: `${FADE_MS}ms`,
      }}
      data-blank={state.blank || undefined}
      data-current={current || undefined}
      aria-hidden={!current || undefined}
    >
      {!state.blank && slide?.kind === "image" && (
        <img className="present-image" src={slide.src} alt={`${slide.deckName}, slide ${slide.index + 1} of ${slide.count}`} draggable={false} />
      )}
      {!state.blank && verseSlide && (
        <div className="present-slide" style={{ padding: `${padY}px ${padX}px` }}>
          {verseSlide.label && (
            <p className="present-caption" style={{ color: theme.caption, fontSize: `${captionSize}px` }}>
              {verseSlide.label}
            </p>
          )}
          <p className="present-text" style={{ fontSize: `${fit?.size ?? minSize}px`, lineHeight: LINE_HEIGHT }}>
            {fit ? (
              fit.lines.map((line, i) => (
                <span key={i} className="present-line">
                  {line}
                </span>
              ))
            ) : (
              <span className="present-line">{verseSlide.text}</span>
            )}
          </p>
          <p className="present-reference" style={{ color: theme.caption, fontSize: `${refSize}px` }}>
            {verseSlide.reference}
          </p>
        </div>
      )}
      {!state.blank && !slide && (
        <p className="present-standby" style={{ color: theme.caption, fontSize: `${refSize}px` }}>
          Ready to present
        </p>
      )}
    </div>
  );
}
