// Reading plans. What each day reads is worked out here from the chapters of the Bible, balanced by length; the app
// stores only which plans the reader has started and which days are done, so a plan can change without losing progress.

import type { ChapterSize, StartedPlan } from "./api";
import { formatVerses } from "./verses";

export interface PlanChapter {
  book: number;
  chapter: number;
}

export interface PlanDay {
  /** 1-based. */
  day: number;
  chapters: PlanChapter[];
}

export interface Plan {
  /** Short and stable: it is what progress is saved under. */
  id: string;
  name: string;
  blurb: string;
  days: PlanDay[];
}

// Book numbers, as in the database.
const PSALMS = 19;
const PROVERBS = 20;
const MATTHEW = 40;
const JOHN = 43;
const REVELATION = 66;

/**
 * Deals `chapters` (in order) into `days` days of about the same length in verses, never splitting a chapter and
 * never leaving a day empty. A chapter goes to the day it is closer to the middle of.
 */
export function spread(chapters: readonly ChapterSize[], days: number): PlanChapter[][] {
  if (days < 1 || chapters.length < days) throw new Error(`cannot spread ${chapters.length} chapters over ${days} days`);
  let remaining = chapters.reduce((n, c) => n + c.verses, 0);
  const out: PlanChapter[][] = [];
  let next = 0;
  for (let d = 1; d <= days; d++) {
    const day: PlanChapter[] = [];
    const last = d === days;
    // Each day aims at an even share of what is left, so a long chapter that overshoots one day lightens the rest.
    const target = remaining / (days - d + 1);
    let length = 0;
    while (next < chapters.length) {
      const c = chapters[next];
      if (!last) {
        const leavesEnough = chapters.length - next > days - d; // one chapter at least for each later day
        const wanted = day.length === 0 || length + c.verses / 2 <= target;
        if (!leavesEnough || !wanted) break;
      }
      day.push({ book: c.book, chapter: c.chapter });
      length += c.verses;
      remaining -= c.verses;
      next++;
    }
    out.push(day);
  }
  return out;
}

const toDays = (chapters: PlanChapter[][]): PlanDay[] => chapters.map((c, i) => ({ day: i + 1, chapters: c }));

/**
 * Psalms and Proverbs in 31 days: on day d, Proverbs d and five psalms spread across the book (d, d+30, d+60, d+90,
 * d+120), so every day mixes praise with wisdom; day 31 is Proverbs 31 alone.
 */
function psalmsAndProverbs(): PlanDay[] {
  return toDays(
    Array.from({ length: 31 }, (_, i) => {
      const d = i + 1;
      const psalms = d <= 30 ? [0, 30, 60, 90, 120].map((k) => ({ book: PSALMS, chapter: d + k })) : [];
      return [...psalms, { book: PROVERBS, chapter: d }];
    }),
  );
}

/** The plans on offer, built from the chapters of the Bible. */
export function buildPlans(sizes: readonly ChapterSize[]): Plan[] {
  const within = (from: number, to: number) => sizes.filter((c) => c.book >= from && c.book <= to);
  return [
    {
      id: "bible-year",
      name: "The Bible in a year",
      blurb: "All 66 books in order, in 365 days of about three chapters.",
      days: toDays(spread(sizes, 365)),
    },
    {
      id: "nt-90",
      name: "The New Testament in 90 days",
      blurb: "Matthew to Revelation, about three chapters a day.",
      days: toDays(spread(within(MATTHEW, REVELATION), 90)),
    },
    {
      id: "gospels-30",
      name: "The Gospels in a month",
      blurb: "Matthew, Mark, Luke and John in 30 days.",
      days: toDays(spread(within(MATTHEW, JOHN), 30)),
    },
    {
      id: "psalms-proverbs",
      name: "Psalms and Proverbs in a month",
      blurb: "Five psalms and a chapter of Proverbs a day, for 31 days.",
      days: psalmsAndProverbs(),
    },
  ];
}

/** "Genesis 30–32", "Psalm 1, 31, 61 · Proverbs 1": the day's chapters, grouped by book. `titleOf` names a book. */
export function dayLabel(day: PlanDay, titleOf: (book: number) => string): string {
  const groups: { book: number; chapters: number[] }[] = [];
  for (const c of day.chapters) {
    const last = groups[groups.length - 1];
    if (last && last.book === c.book) last.chapters.push(c.chapter);
    else groups.push({ book: c.book, chapters: [c.chapter] });
  }
  return groups.map((g) => `${titleOf(g.book)} ${formatVerses(g.chapters)}`).join(" · ");
}

/** The first day not yet done, or null when the plan is finished. */
export function nextDay(plan: Plan, done: ReadonlySet<number>): PlanDay | null {
  return plan.days.find((d) => !done.has(d.day)) ?? null;
}

export interface Progress {
  done: number;
  total: number;
  /** Whole percent, 0 to 100. */
  percent: number;
  finished: boolean;
}

export function progress(plan: Plan, done: ReadonlySet<number>): Progress {
  const count = plan.days.filter((d) => done.has(d.day)).length;
  const total = plan.days.length;
  return { done: count, total, percent: total ? Math.floor((count * 100) / total) : 0, finished: total > 0 && count === total };
}

/** Today's date as the reader's clock says it, `YYYY-MM-DD`. */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * How many days in a row, ending today or yesterday, the reader has finished something. A day not yet read today
 * doesn't break a streak that was alive yesterday.
 */
export function streak(doneDates: readonly string[], today: string): number {
  const days = new Set(doneDates.map(dayNumber));
  let d = dayNumber(today);
  if (!days.has(d)) d--;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

/** The dates on which anything was finished, across every started plan. */
export const allDoneDates = (started: readonly StartedPlan[]): string[] => started.flatMap((p) => p.done.map((d) => d.doneOn));
