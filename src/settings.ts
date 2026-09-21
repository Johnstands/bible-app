import { loadJson, saveJson } from "./storage";

export const WORD_HELP_LEVELS = ["off", "changed", "all"] as const;
/** How much to underline: nothing, only words whose meaning has changed, or archaic words and measures too. */
export type WordHelpLevel = (typeof WORD_HELP_LEVELS)[number];

export const WORD_HELP_LABELS: Record<WordHelpLevel, string> = {
  off: "Off",
  changed: "Changed meanings",
  all: "All words",
};

export const THEMES = ["paper", "sepia", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = { paper: "Paper", sepia: "Sepia", dark: "Dark" };

// Each face is bundled with the app (see main.tsx), so the reader works offline.
export const FONTS = {
  garamond: { label: "EB Garamond", stack: '"EB Garamond Variable", "EB Garamond", Georgia, serif' },
  literata: { label: "Literata", stack: '"Literata Variable", "Literata", Georgia, serif' },
  "source-serif": { label: "Source Serif", stack: '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif' },
} as const;
export type FontFamily = keyof typeof FONTS;

/** Reading size as a multiple of the base size (1 = the default 1.3rem). */
export const FONT_SCALE = { min: 0.85, max: 1.6, step: 0.05, default: 1 } as const;

export interface Settings {
  theme: Theme;
  fontFamily: FontFamily;
  fontScale: number;
  /** One verse per line instead of flowing paragraphs. Poetry is unaffected. */
  verseByVerse: boolean;
  /** A ¶ at the start of each paragraph. */
  pilcrows: boolean;
  /** Show the verse of the day when the app opens, once a day. */
  verseOfTheDay: boolean;
  /** Underline words that are archaic or meant something else in 1611; click one for its meaning. */
  wordHelp: WordHelpLevel;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "paper",
  fontFamily: "garamond",
  fontScale: FONT_SCALE.default,
  verseByVerse: false,
  pilcrows: false,
  verseOfTheDay: true,
  wordHelp: "all",
};

/** Rounds to the nearest step and keeps the size within range. */
export function clampScale(n: number): number {
  const stepped = Math.round(n / FONT_SCALE.step) * FONT_SCALE.step;
  return Math.round(Math.min(FONT_SCALE.max, Math.max(FONT_SCALE.min, stepped)) * 100) / 100;
}

/** Reads a stored word-help level, including the on/off value it had before it had levels. */
function sanitizeWordHelp(v: unknown): WordHelpLevel | null {
  if (typeof v === "boolean") return v ? "all" : "off";
  return WORD_HELP_LEVELS.includes(v as WordHelpLevel) ? (v as WordHelpLevel) : null;
}

/**
 * Turns whatever was stored into valid settings, field by field, so a value that is missing,
 * from an older version or hand-edited falls back to its default instead of breaking the app.
 * `legacyTheme` is the theme saved before settings existed.
 */
export function sanitizeSettings(raw: unknown, legacyTheme?: unknown): Settings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const theme = [r.theme, legacyTheme].find((t) => THEMES.includes(t as Theme)) as Theme | undefined;
  return {
    theme: theme ?? d.theme,
    fontFamily: typeof r.fontFamily === "string" && Object.prototype.hasOwnProperty.call(FONTS, r.fontFamily) ? (r.fontFamily as FontFamily) : d.fontFamily,
    fontScale: typeof r.fontScale === "number" && Number.isFinite(r.fontScale) ? clampScale(r.fontScale) : d.fontScale,
    verseByVerse: typeof r.verseByVerse === "boolean" ? r.verseByVerse : d.verseByVerse,
    pilcrows: typeof r.pilcrows === "boolean" ? r.pilcrows : d.pilcrows,
    verseOfTheDay: typeof r.verseOfTheDay === "boolean" ? r.verseOfTheDay : d.verseOfTheDay,
    wordHelp: sanitizeWordHelp(r.wordHelp) ?? d.wordHelp,
  };
}

export function loadSettings(): Settings {
  return sanitizeSettings(loadJson("settings"), loadJson("theme"));
}

export function saveSettings(s: Settings) {
  saveJson("settings", s);
}

/** Applies the settings that live in CSS: theme, font and size. */
export function applySettings(s: Settings, root: HTMLElement = document.documentElement) {
  root.dataset.theme = s.theme;
  root.style.setProperty("--font-scripture", FONTS[s.fontFamily].stack);
  root.style.setProperty("--reading-scale", String(s.fontScale));
}
