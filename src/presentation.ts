// Presentation mode: turning a passage into slides to project, independent of how they get on screen
// (a dedicated window or an inline overlay — see Presentation.tsx, PresentationView.tsx).

import { referenceLabel } from "./verses";

/** The dedicated presentation window's label; must match `present::LABEL` in the Rust backend. */
export const PRESENTATION_WINDOW = "presentation";

export interface PassageVerse {
  verse: number;
  text: string;
}

/** A passage within one chapter: what a queue item or an ad-hoc selection turns into slides from. */
export interface Passage {
  book: number;
  chapter: number;
  /** The book title as it reads before a chapter number, e.g. "John" or "Psalm". */
  title: string;
  /** An optional caption for the passage (e.g. "Call to worship"), shown above its reference. */
  label?: string;
  /** In verse order; need not be contiguous. */
  verses: PassageVerse[];
}

export const GRANULARITIES = ["verse", "whole"] as const;
export type Granularity = (typeof GRANULARITIES)[number];
export const GRANULARITY_LABELS: Record<Granularity, string> = { verse: "One verse at a time", whole: "Whole passage" };

export interface PresentSlide {
  book: number;
  chapter: number;
  verse: number;
  verseEnd: number;
  text: string;
  /** "John 3:16" */
  reference: string;
  label?: string;
}

/** Builds a passage's slides: one slide per verse, or the whole passage joined into a single slide. */
export function buildSlides(passage: Passage, granularity: Granularity): PresentSlide[] {
  const { book, chapter, title, label, verses } = passage;
  if (verses.length === 0) return [];
  if (granularity === "verse") {
    return verses.map((v) => ({
      book,
      chapter,
      verse: v.verse,
      verseEnd: v.verse,
      text: v.text,
      reference: referenceLabel(title, chapter, [v.verse]),
      label,
    }));
  }
  const nums = verses.map((v) => v.verse);
  return [
    {
      book,
      chapter,
      verse: nums[0],
      verseEnd: nums[nums.length - 1],
      text: verses.map((v) => v.text).join(" "),
      reference: referenceLabel(title, chapter, nums),
      label,
    },
  ];
}

/**
 * One flowing list of slides for a whole queued service: each passage's slides in order, so stepping
 * past the end of one continues straight into the next — even across a chapter or book boundary.
 */
export function buildQueueSlides(passages: Passage[], granularity: Granularity): PresentSlide[] {
  return passages.flatMap((p) => buildSlides(p, granularity));
}

export const PRESENT_THEMES_LIST = ["dark", "light", "high-contrast"] as const;
export type PresentTheme = (typeof PRESENT_THEMES_LIST)[number];

/** Colors for the projected view, independent of the reader's own theme (a projector wants its own
 *  high-contrast look regardless of what the reader is set to). */
export const PRESENT_THEMES: Record<PresentTheme, { label: string; bg: string; ink: string; caption: string }> = {
  dark: { label: "Dark", bg: "#0b0b0c", ink: "#f4efe4", caption: "#b0a696" },
  light: { label: "Light", bg: "#faf6ec", ink: "#241f19", caption: "#7a7060" },
  "high-contrast": { label: "High contrast", bg: "#000000", ink: "#ffffff", caption: "#cfcfcf" },
};

/** Everything needed to draw the projected screen; pushed whole from the control window. */
export interface PresentationState {
  blank: boolean;
  theme: PresentTheme;
  slide: PresentSlide | null;
}

export const STANDBY_STATE: PresentationState = { blank: false, theme: "dark", slide: null };
