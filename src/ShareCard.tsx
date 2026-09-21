import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useEffect, useRef, useState } from "react";
import { saveImage } from "./api";
import { CARD_SIZES, CARD_THEMES, cardFileName, drawCard, loadCardFonts } from "./verseCard";
import type { CardSize, CardTheme, Drawn } from "./verseCard";
import { useReturnFocus } from "./useReturnFocus";

interface Props {
  /** "John 3:16" */
  reference: string;
  /** The selected verses' text. */
  text: string;
  translation: string;
  /** The reader's chosen face, and the app's UI face, as CSS font-family lists. */
  fontStack: string;
  uiStack: string;
  /** The theme the card starts in: the one the reader is using. */
  theme: CardTheme;
  onClose: () => void;
}

const SIZES = Object.keys(CARD_SIZES) as CardSize[];
const THEMES = Object.keys(CARD_THEMES) as CardTheme[];

const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no image"))), "image/png"));

/** Makes the selected verses into a picture, previews it, and copies it or saves it as a PNG. */
export function ShareCard({ reference, text, translation, fontStack, uiStack, theme: initialTheme, onClose }: Props) {
  const [size, setSize] = useState<CardSize>("square");
  const [theme, setTheme] = useState<CardTheme>(initialTheme);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; path?: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useReturnFocus();
  useEffect(() => panelRef.current?.focus(), []);

  // Draw again whenever the card changes, once its fonts are ready.
  useEffect(() => {
    let stale = false;
    setStatus(null);
    loadCardFonts([fontStack, uiStack]).then(() => {
      const canvas = canvasRef.current;
      if (stale || !canvas) return;
      setDrawn(drawCard(canvas, { size, theme, text, reference, translation, fontStack, uiStack }));
    });
    return () => {
      stale = true;
    };
  }, [size, theme, text, reference, translation, fontStack, uiStack]);

  const fits = drawn !== null && drawn.fontSize !== null;

  const copy = async () => {
    if (!canvasRef.current) return;
    setBusy(true);
    try {
      const blob = await toBlob(canvasRef.current);
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("unsupported");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus({ text: "Image copied. Paste it into a message or document." });
    } catch {
      setStatus({ text: "Couldn’t copy the image here. Save it instead." });
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!canvasRef.current) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await (await toBlob(canvasRef.current)).arrayBuffer());
      const path = await saveImage(cardFileName(reference), Array.from(bytes));
      setStatus({ text: `Saved to ${path}`, path });
    } catch (e) {
      setStatus({ text: `Couldn’t save the image: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const showInFolder = (path: string) => {
    revealItemInDir(path).catch(() => setStatus({ text: `Saved to ${path}` }));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const { width, height } = CARD_SIZES[size];
  return (
    <div className="scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="goto share"
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${reference} as an image`}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="share-body">
          <div className="share-preview">
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              role="img"
              aria-label={`Preview of a card with ${reference}`}
              data-font-size={drawn?.fontSize ?? ""}
              data-lines={drawn?.lines ?? ""}
              data-size={size}
              data-theme={theme}
            />
          </div>

          <div className="share-controls">
            <h2 className="share-title">Share as an image</h2>

            <div className="share-group" role="group" aria-label="Shape">
              {SIZES.map((s) => (
                <button key={s} aria-pressed={size === s} onClick={() => setSize(s)}>
                  {CARD_SIZES[s].label}
                </button>
              ))}
            </div>
            <div className="share-group" role="group" aria-label="Color">
              {THEMES.map((t) => (
                <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>
                  {CARD_THEMES[t].label}
                </button>
              ))}
            </div>

            <div className="share-actions">
              <button className="share-primary" onClick={save} disabled={!fits || busy}>
                Save image
              </button>
              <button className="share-secondary" onClick={copy} disabled={!fits || busy}>
                Copy image
              </button>
            </div>

            <p className="share-status" role="status">
              {drawn && !fits ? "That is too much text for one card. Select fewer verses." : status?.text}
              {status?.path && (
                <>
                  {" "}
                  <button className="share-link" onClick={() => showInFolder(status.path!)}>
                    Show in folder
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="goto-footer">
          <span>{reference}</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
