import { useEffect, useMemo, useRef, useState } from "react";
import { fitText } from "./verseCard";
import { PRESENT_THEMES } from "./presentation";
import type { PresentationState } from "./presentation";

const LINE_HEIGHT = 1.32;
const MIN_SIZE = 28;
const VERSE_FONT = '500 1px "EB Garamond Variable", "EB Garamond", Georgia, serif';

interface Props {
  state: PresentationState;
}

/**
 * Renders whatever `state` says to show: a blank/black screen, a standby message, or the current
 * slide's text as large as will fit the window. Used both as the whole UI of the dedicated
 * presentation window (see Presentation.tsx) and, on a single-monitor machine, as a full-screen
 * overlay inside the main window (see App.tsx) — so it takes no dependency on which window it's in.
 */
export function PresentationView({ state }: Props) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const measureCanvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const update = () => setBox({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const theme = PRESENT_THEMES[state.theme];
  const padX = Math.round(box.width * 0.08);
  const padY = Math.round(box.height * 0.1);
  const hasCaption = Boolean(state.slide?.label);
  const captionH = hasCaption ? box.height * 0.07 : 0;
  const refH = box.height * 0.08;

  const fit = useMemo(() => {
    if (!state.slide || box.width === 0 || box.height === 0) return null;
    const canvas = (measureCanvas.current ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d")!;
    const measure = (text: string, size: number) => {
      ctx.font = VERSE_FONT.replace("1px", `${size}px`);
      return ctx.measureText(text).width;
    };
    return fitText(
      state.slide.text,
      { width: box.width - padX * 2, height: box.height - padY * 2 - captionH - refH },
      measure,
      { maxSize: Math.round(box.width * 0.055), minSize: MIN_SIZE, lineHeight: LINE_HEIGHT },
    );
  }, [state.slide, box, padX, padY, captionH, refH]);

  return (
    <div className="present-view" style={{ background: theme.bg, color: theme.ink }} data-blank={state.blank || undefined}>
      {!state.blank && state.slide && (
        <div className="present-slide">
          {state.slide.label && (
            <p className="present-caption" style={{ color: theme.caption }}>
              {state.slide.label}
            </p>
          )}
          <p className="present-text" style={{ fontSize: `${fit?.size ?? MIN_SIZE}px`, lineHeight: LINE_HEIGHT }}>
            {fit ? (
              fit.lines.map((line, i) => (
                <span key={i} className="present-line">
                  {line}
                </span>
              ))
            ) : (
              <span className="present-line">{state.slide.text}</span>
            )}
          </p>
          <p className="present-reference" style={{ color: theme.caption }}>
            {state.slide.reference}
          </p>
        </div>
      )}
      {!state.blank && !state.slide && (
        <p className="present-standby" style={{ color: theme.caption }}>
          Ready to present
        </p>
      )}
    </div>
  );
}
