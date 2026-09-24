// Presentation mode's own appearance preferences (not the saved playlists, which live in user.db —
// see api.ts). Small and throwaway, like userSettings.ts, so it follows the same shape.

import { GRANULARITIES, PRESENT_THEMES_LIST } from "./presentation";
import type { Granularity, PresentTheme } from "./presentation";
import { loadJson, saveJson } from "./storage";

export interface PresentationPrefs {
  theme: PresentTheme;
  granularity: Granularity;
}

export const DEFAULT_PRESENTATION_PREFS: PresentationPrefs = { theme: "dark", granularity: "verse" };

/** Turns whatever was stored into valid preferences, field by field, like `sanitizeSettings`. */
export function sanitizePresentationPrefs(raw: unknown): PresentationPrefs {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PRESENTATION_PREFS;
  return {
    theme: PRESENT_THEMES_LIST.includes(r.theme as PresentTheme) ? (r.theme as PresentTheme) : d.theme,
    granularity: GRANULARITIES.includes(r.granularity as Granularity) ? (r.granularity as Granularity) : d.granularity,
  };
}

export function loadPresentationPrefs(): PresentationPrefs {
  return sanitizePresentationPrefs(loadJson("presentationPrefs"));
}

export function savePresentationPrefs(p: PresentationPrefs) {
  saveJson("presentationPrefs", p);
}
