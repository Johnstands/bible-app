import { useEffect, useMemo, useRef, useState } from "react";
import { fitText } from "./verseCard";
import { PRESENT_THEMES } from "./presentation";
import type { PresentationState } from "./presentation";

const LINE_HEIGHT = 1.32;
const VERSE_FONT = '500 1px "EB Garamond Variable", "EB Garamond", Georgia, serif';

interface Props {
  state: PresentationState;
}

/**
 * Renders whatever `state` says to show: a blank/black screen, a standby message, the current
 * verse slide's text as large as will fit its container, or an imported slide's picture. Sizes itself entirely from the box it's given
 * (a `ResizeObserver` on its own root, not the window), so the same component works full-bleed as
 * the whole UI of the dedicated presentation window (see PresentationWindow.tsx) and small, as the control
 * center's live preview (see PresentationDock.tsx) — the truest possible preview of what's on screen.
 */
export function PresentationView({ state }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const measureCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    const canvas = (measureCanvas.current ??= document.createElement("canvas"));
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
      ref={wrapRef}
      className="present-view"
      // Pictures are letterboxed on black, whatever the verses' Dark/Light setting.
      style={{ background: slide?.kind === "image" ? "#000" : theme.bg, color: theme.ink }}
      data-blank={state.blank || undefined}
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
