// Presentation mode: turning a passage into slides to project, independent of how they get on screen
// (a dedicated window or an inline overlay — see PresentationWindow.tsx, PresentationView.tsx).

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

export interface VerseSlide {
  kind: "verse";
  book: number;
  chapter: number;
  verse: number;
  verseEnd: number;
  text: string;
  /** "John 3:16" */
  reference: string;
  label?: string;
}

/** One slide of an imported deck: a picture shown as-is, letterboxed on black. */
export interface ImageSlide {
  kind: "image";
  src: string;
  deckName: string;
  /** 0-based position within its deck. */
  index: number;
  count: number;
}

export type PresentSlide = VerseSlide | ImageSlide;

/** A deck of slide images as queued in a playlist: its name and where each slide loads from. */
export interface QueuedDeck {
  name: string;
  srcs: string[];
}

/** One playlist item, ready to turn into slides; null for one with none (e.g. a passage whose
 *  chapter failed to load), which still keeps its place so item positions line up. */
export type QueueEntry = Passage | QueuedDeck | null;

/** Where one playlist item's slides sit in the flowing queue. */
export interface ItemSpan {
  start: number;
  count: number;
}

export interface Queue {
  slides: PresentSlide[];
  /** One per queue entry, in order: jumping to an item is `slides[items[i].start]`. */
  items: ItemSpan[];
}

const isDeck = (e: Passage | QueuedDeck): e is QueuedDeck => "srcs" in e;

/** A short caption for any slide: "John 3:16", or "Welcome.png · 3 of 12". */
export function slideCaption(slide: PresentSlide): string {
  return slide.kind === "image" ? `${slide.deckName} · ${slide.index + 1} of ${slide.count}` : slide.reference;
}

/** Builds a passage's slides: one slide per verse, or the whole passage joined into a single slide. */
export function buildSlides(passage: Passage, granularity: Granularity): VerseSlide[] {
  const { book, chapter, title, label, verses } = passage;
  if (verses.length === 0) return [];
  if (granularity === "verse") {
    return verses.map((v) => ({
      kind: "verse" as const,
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
      kind: "verse",
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
 * One flowing list of slides for a whole queued playlist: each item's slides in order (a passage's
 * verses, a deck's pictures), so stepping past the end of one continues straight into the next —
 * even across a chapter or book boundary, or from a passage into a deck.
 */
export function buildQueue(entries: QueueEntry[], granularity: Granularity): Queue {
  const slides: PresentSlide[] = [];
  const items = entries.map((entry) => {
    const start = slides.length;
    if (entry && isDeck(entry)) {
      entry.srcs.forEach((src, index) => slides.push({ kind: "image", src, deckName: entry.name, index, count: entry.srcs.length }));
    } else if (entry) {
      slides.push(...buildSlides(entry, granularity));
    }
    return { start, count: slides.length - start };
  });
  return { slides, items };
}

/** Which item (index into `items`) the slide at `slideIndex` belongs to, or -1. */
export function itemAt(items: ItemSpan[], slideIndex: number): number {
  return items.findIndex((it) => slideIndex >= it.start && slideIndex < it.start + it.count);
}

export const PRESENT_THEMES_LIST = ["dark", "light"] as const;
export type PresentTheme = (typeof PRESENT_THEMES_LIST)[number];

/** Colors for the projected view, independent of the reader's own theme. */
export const PRESENT_THEMES: Record<PresentTheme, { label: string; bg: string; ink: string; caption: string }> = {
  dark: { label: "Dark", bg: "#0b0b0c", ink: "#f4efe4", caption: "#b0a696" },
  light: { label: "Light", bg: "#faf6ec", ink: "#241f19", caption: "#7a7060" },
};

export const TRANSITIONS = ["fade", "cut"] as const;
export type Transition = (typeof TRANSITIONS)[number];
export const TRANSITION_LABELS: Record<Transition, string> = { fade: "Fade", cut: "Cut" };

/** How long a fade between two screens takes, in milliseconds. Short, so stepping verse by verse
 *  never feels slow. */
export const FADE_MS = 400;

/** Everything needed to draw the projected screen; pushed whole from the control window. */
export interface PresentationState {
  blank: boolean;
  theme: PresentTheme;
  slide: PresentSlide | null;
  /** How the screen changes to the next thing shown. */
  transition: Transition;
  /** A picture to load ahead of time (the next slide's), so a fade to it can start at once. */
  preload: string | null;
}

export const STANDBY_STATE: PresentationState = { blank: false, theme: "dark", slide: null, transition: "fade", preload: null };

/**
 * What the screen looks like, as a string: two states with the same key look identical, so going
 * from one to the other needs no transition (e.g. only `preload` changed).
 */
export function screenKey(state: PresentationState): string {
  if (state.blank) return "blank";
  const s = state.slide;
  if (!s) return `standby:${state.theme}`;
  if (s.kind === "image") return `image:${s.src}`;
  return `verse:${state.theme}:${s.reference}:${s.label ?? ""}:${s.text}`;
}
