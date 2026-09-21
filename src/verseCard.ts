// A verse drawn as a picture to share. The layout (wrapping and sizing the text) is separate from the drawing, so it
// can be tested without a canvas.

export const CARD_SIZES = {
  square: { label: "Square", width: 1080, height: 1080 },
  portrait: { label: "Portrait", width: 1080, height: 1350 },
  wide: { label: "Wide", width: 1200, height: 630 },
} as const;
export type CardSize = keyof typeof CARD_SIZES;

/** The colors of each theme, as in theme.css, so a card looks like the page it came from. */
export const CARD_THEMES = {
  paper: { label: "Paper", bg: "#faf6ec", ink: "#2a2622", muted: "#736a5d", rule: "#ddd2b9", accent: "#7a2e2e", gold: "#b08d4a" },
  sepia: { label: "Sepia", bg: "#f0e4cc", ink: "#3b2f22", muted: "#6e5f49", rule: "#d2bf9a", accent: "#7a2e2e", gold: "#9a7534" },
  dark: { label: "Dark", bg: "#1c1917", ink: "#e8dfcb", muted: "#9a9080", rule: "#3a342d", accent: "#c9a45c", gold: "#c9a45c" },
} as const;
export type CardTheme = keyof typeof CARD_THEMES;

/** The width in pixels of `text` set at `size` px. */
export type Measure = (text: string, size: number) => number;

/** Breaks `text` into lines no wider than `maxWidth`, at spaces. A word wider than that gets a line to itself. */
export function wrapLines(text: string, maxWidth: number, widthOf: (text: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && widthOf(next) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Re-breaks `text` into exactly `count` lines, none wider than `maxWidth`, choosing the breaks that leave every line
 * as full as the others (least total squared slack). Greedy wrapping crams the early lines and can strand one word
 * on the last; this evens them out. Falls back to greedy wrapping if `count` lines can't hold the text.
 */
export function balanceLines(text: string, maxWidth: number, count: number, widthOf: (text: string) => number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length;
  if (count < 2 || n <= count) return wrapLines(text, maxWidth, widthOf);
  const MAX_WORDS_PER_LINE = 24;
  // cost[i][j]: squared slack of a line holding words i..j-1, or Infinity if it doesn't fit.
  const cost = (i: number, j: number) => {
    const width = widthOf(words.slice(i, j).join(" "));
    if (width > maxWidth) return j - i === 1 ? 0 : Infinity; // a single over-long word can't be helped
    return (maxWidth - width) ** 2;
  };
  const line = (i: number, j: number, memo = new Map<number, number>()) => {
    const key = i * (n + 1) + j;
    let c = memo.get(key);
    if (c === undefined) memo.set(key, (c = cost(i, j)));
    return c;
  };
  const memo = new Map<number, number>();
  // best[k][j]: least cost of setting the first j words in k lines; from[k][j] where the last line begins.
  const best = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const from = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(-1));
  best[0][0] = 0;
  for (let k = 1; k <= count; k++) {
    for (let j = k; j <= n; j++) {
      for (let i = Math.max(k - 1, j - MAX_WORDS_PER_LINE); i < j; i++) {
        if (best[k - 1][i] === Infinity) continue;
        const total = best[k - 1][i] + line(i, j, memo);
        if (total < best[k][j]) {
          best[k][j] = total;
          from[k][j] = i;
        }
      }
    }
  }
  if (best[count][n] === Infinity) return wrapLines(text, maxWidth, widthOf);
  const lines: string[] = [];
  for (let k = count, j = n; k >= 1; k--) {
    const i = from[k][j];
    lines.unshift(words.slice(i, j).join(" "));
    j = i;
  }
  return lines;
}

export interface Fit {
  size: number;
  lines: string[];
}

export interface FitOptions {
  maxSize: number;
  minSize: number;
  /** Line height as a multiple of the size. */
  lineHeight: number;
  /** Size steps to try, in px. */
  step?: number;
}

/**
 * The largest type size (within the limits) at which `text` wraps to fit the box, with its lines (balanced, so no
 * word is stranded on the last); null if even the smallest size is too big, which means there is too much text.
 */
export function fitText(text: string, box: { width: number; height: number }, measure: Measure, opts: FitOptions): Fit | null {
  const step = opts.step ?? 2;
  for (let size = opts.maxSize; size >= opts.minSize; size -= step) {
    const widthOf = (t: string) => measure(t, size);
    const lines = wrapLines(text, box.width, widthOf);
    if (lines.length * size * opts.lineHeight <= box.height) {
      // Same number of lines, so it still fits; just spread the words more evenly.
      return { size, lines: balanceLines(text, box.width, lines.length, widthOf) };
    }
  }
  return null;
}

/** Curly quotes around the verse, as a printed quotation has them. */
export const quoted = (text: string) => `“${text.trim()}”`;

/** "John 3:16" -> "John 3-16.png": a name that is safe on every file system. */
export function cardFileName(reference: string): string {
  const name = reference
    .replace(/[–—]/g, "-")
    .replace(/:/g, "-")
    .replace(/[^\p{L}\p{N} _-]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${name || "verse"}.png`;
}

export interface CardSpec {
  size: CardSize;
  theme: CardTheme;
  /** The verses' text, without quotation marks. */
  text: string;
  /** "John 3:16" */
  reference: string;
  /** "King James Version" */
  translation: string;
  /** CSS font-family list for the verse; the smaller print uses the UI face. */
  fontStack: string;
  uiStack: string;
}

export interface Drawn {
  /** The verse's type size in px, or null when the text is too long for the card. */
  fontSize: number | null;
  lines: number;
}

/** Letter-spaced text centered on `x`, drawn a character at a time because `letterSpacing` isn't in every webview. */
function drawSpaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number) {
  const widths = [...text].map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (widths.length - 1);
  let at = x - total / 2;
  ctx.textAlign = "left";
  [...text].forEach((c, i) => {
    ctx.fillText(c, at, y);
    at += widths[i] + spacing;
  });
}

/** A thin rule with a diamond in the middle, like the ornament under a chapter heading in the reader. */
function drawOrnament(ctx: CanvasRenderingContext2D, cx: number, y: number, half: number, colors: { rule: string; gold: string }) {
  const gap = 16;
  ctx.strokeStyle = colors.gold;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - half, y);
  ctx.lineTo(cx - gap, y);
  ctx.moveTo(cx + gap, y);
  ctx.lineTo(cx + half, y);
  ctx.stroke();
  ctx.fillStyle = colors.gold;
  ctx.beginPath();
  ctx.moveTo(cx, y - 8);
  ctx.lineTo(cx + 8, y);
  ctx.lineTo(cx, y + 8);
  ctx.lineTo(cx - 8, y);
  ctx.closePath();
  ctx.fill();
}

/** Draws the card onto `canvas`, sizing it to the chosen format. The fonts must already be loaded. */
export function drawCard(canvas: HTMLCanvasElement, spec: CardSpec): Drawn {
  const { width, height } = CARD_SIZES[spec.size];
  const c = CARD_THEMES[spec.theme];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, width, height);

  // A hairline frame inset from the edge, as on a printed page.
  const inset = Math.round(Math.min(width, height) * 0.035);
  ctx.strokeStyle = c.rule;
  ctx.lineWidth = 2;
  ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);

  const cx = width / 2;
  const wide = width > height * 1.5;
  const padX = width * (wide ? 0.11 : 0.12);
  const top = height * (wide ? 0.13 : 0.14);
  const footer = height * (wide ? 0.2 : 0.17); // room kept for the reference and translation
  drawOrnament(ctx, cx, top, Math.min(width * 0.09, 110), c);

  const box = { width: width - padX * 2, height: height - top - footer - height * 0.09 };
  const verseFont = (size: number) => `400 ${size}px ${spec.fontStack}`;
  const fit = fitText(
    quoted(spec.text),
    box,
    (t, size) => {
      ctx.font = verseFont(size);
      return ctx.measureText(t).width;
    },
    { maxSize: Math.round(width * (wide ? 0.052 : 0.068)), minSize: Math.round(width * 0.026), lineHeight: 1.36 },
  );

  if (fit) {
    ctx.font = verseFont(fit.size);
    ctx.fillStyle = c.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    const lineHeight = fit.size * 1.36;
    const block = fit.lines.length * lineHeight;
    // Centered in the space between the ornament and the reference.
    const start = top + height * 0.05 + (box.height - block) / 2 + fit.size;
    fit.lines.forEach((line, i) => ctx.fillText(line, cx, start + i * lineHeight));
  } else {
    ctx.font = `italic 400 ${Math.round(width * 0.04)}px ${spec.fontStack}`;
    ctx.fillStyle = c.muted;
    ctx.textAlign = "center";
    ctx.fillText("Too much text for one card", cx, height / 2);
  }

  // Reference and translation, centered near the foot.
  const refSize = Math.round(width * (wide ? 0.03 : 0.033));
  const refY = height - footer + refSize * 0.9;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = c.accent;
  ctx.font = `500 ${refSize}px ${spec.uiStack}`;
  drawSpaced(ctx, spec.reference.toUpperCase(), cx, refY, refSize * 0.14);
  ctx.fillStyle = c.muted;
  ctx.textAlign = "center";
  ctx.font = `italic 400 ${Math.round(refSize * 1.05)}px ${spec.fontStack}`;
  ctx.fillText(spec.translation, cx, refY + refSize * 1.55);

  return { fontSize: fit?.size ?? null, lines: fit?.lines.length ?? 0 };
}

/** Loads the faces a card uses, so the canvas doesn't draw with a fallback while they are still arriving. */
export async function loadCardFonts(stacks: string[]): Promise<void> {
  const styles = ["400 40px", "italic 400 40px", "500 40px"];
  await Promise.all(stacks.flatMap((stack) => styles.map((s) => document.fonts.load(`${s} ${stack}`).catch(() => []))));
}
