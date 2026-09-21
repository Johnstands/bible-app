import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ChapterSize, StartedPlan } from "./api";
import { allDoneDates, buildPlans, dayLabel, localDate, nextDay, progress, spread, streak } from "./plans";
import type { Plan, PlanChapter } from "./plans";

// The real chapters of the Bible, as the list_chapters command returns them.
const db = new DatabaseSync(path.resolve(__dirname, "../src-tauri/resources/bible.db"), { readOnly: true });
const SIZES: ChapterSize[] = db
  .prepare("SELECT book, chapter, MAX(COALESCE(verse_end, verse)) AS verses FROM verses GROUP BY book, chapter ORDER BY book, chapter")
  .all() as unknown as ChapterSize[];
const PLANS = buildPlans(SIZES);
const plan = (id: string) => PLANS.find((p) => p.id === id)!;

const flat = (p: Plan): PlanChapter[] => p.days.flatMap((d) => d.chapters);
const key = (c: PlanChapter) => `${c.book}:${c.chapter}`;
const verses = (chapters: PlanChapter[]) =>
  chapters.reduce((n, c) => n + SIZES.find((s) => s.book === c.book && s.chapter === c.chapter)!.verses, 0);
const titleOf = (book: number) => (book === 1 ? "Genesis" : book === 19 ? "Psalm" : book === 20 ? "Proverbs" : `Book ${book}`);

describe("spread", () => {
  const synthetic = (verses: number[]): ChapterSize[] => verses.map((v, i) => ({ book: 1, chapter: i + 1, verses: v }));

  it("keeps every chapter once, in order, and never leaves a day empty", () => {
    for (const days of [1, 2, 7, 40, 100]) {
      const chapters = synthetic(Array.from({ length: 100 }, (_, i) => 5 + ((i * 7) % 30)));
      const out = spread(chapters, days);
      expect(out).toHaveLength(days);
      expect(out.every((d) => d.length > 0)).toBe(true);
      expect(out.flat().map((c) => c.chapter)).toEqual(chapters.map((c) => c.chapter));
    }
  });

  it("balances by length: a long chapter gets a day nearly to itself", () => {
    const out = spread(synthetic([10, 10, 10, 100, 10, 10, 10, 10]), 4);
    expect(out.map((d) => d.map((c) => c.chapter))).toEqual([[1, 2, 3], [4], [5, 6], [7, 8]]);
  });

  it("gives one chapter a day when there are as many days as chapters", () => {
    expect(spread(synthetic([5, 80, 5]), 3).map((d) => d.length)).toEqual([1, 1, 1]);
  });

  it("refuses more days than chapters", () => {
    expect(() => spread(synthetic([5, 5]), 3)).toThrow();
    expect(() => spread(synthetic([5, 5]), 0)).toThrow();
  });
});

describe("the plans", () => {
  it("are all there, with stable ids", () => {
    expect(PLANS.map((p) => p.id)).toEqual(["bible-year", "nt-90", "gospels-30", "psalms-proverbs"]);
    expect(PLANS.map((p) => p.days.length)).toEqual([365, 90, 30, 31]);
    for (const p of PLANS) expect(p.days.map((d) => d.day)).toEqual(p.days.map((_, i) => i + 1));
  });

  it("the Bible in a year reads all 1,189 chapters once, in order", () => {
    const read = flat(plan("bible-year")).map(key);
    expect(read).toEqual(SIZES.map(key));
    expect(plan("bible-year").days.every((d) => d.chapters.length > 0)).toBe(true);
  });

  it("the New Testament in 90 days is Matthew to Revelation, once each", () => {
    const read = flat(plan("nt-90"));
    expect(read).toHaveLength(260);
    expect(read.map(key)).toEqual(SIZES.filter((s) => s.book >= 40).map(key));
  });

  it("the Gospels in a month is the four Gospels, once each", () => {
    const read = flat(plan("gospels-30"));
    expect(read).toHaveLength(89);
    expect(new Set(read.map((c) => c.book))).toEqual(new Set([40, 41, 42, 43]));
    expect(read.map(key)).toEqual(SIZES.filter((s) => s.book >= 40 && s.book <= 43).map(key));
  });

  it("Psalms and Proverbs mixes five psalms with a proverb each day, covering both books once", () => {
    const p = plan("psalms-proverbs");
    expect(p.days[0].chapters.map(key)).toEqual(["19:1", "19:31", "19:61", "19:91", "19:121", "20:1"]);
    expect(p.days[29].chapters.map(key)).toEqual(["19:30", "19:60", "19:90", "19:120", "19:150", "20:30"]);
    expect(p.days[30].chapters.map(key)).toEqual(["20:31"]);
    const read = flat(p);
    expect(read).toHaveLength(181);
    expect(new Set(read.map(key)).size).toBe(181);
    expect(read.filter((c) => c.book === 19).map((c) => c.chapter).sort((a, b) => a - b)).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(read.filter((c) => c.book === 20).map((c) => c.chapter).sort((a, b) => a - b)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });

  it("keep the days of the year plan reasonably even", () => {
    const p = plan("bible-year");
    const target = SIZES.reduce((n, s) => n + s.verses, 0) / 365;
    for (const d of p.days) {
      // A single long chapter (Psalm 119, Numbers 7) may exceed the target; anything else stays close to it.
      if (d.chapters.length > 1) expect(verses(d.chapters), `day ${d.day}`).toBeLessThan(target * 1.8);
    }
    const lengths = p.days.map((d) => verses(d.chapters)).sort((a, b) => a - b);
    expect(lengths[Math.floor(lengths.length / 2)]).toBeGreaterThan(target * 0.6);
  });
});

describe("dayLabel", () => {
  it("names a run of chapters, and several books", () => {
    expect(dayLabel({ day: 1, chapters: [{ book: 1, chapter: 30 }, { book: 1, chapter: 31 }, { book: 1, chapter: 32 }] }, titleOf)).toBe("Genesis 30–32");
    expect(dayLabel({ day: 1, chapters: [{ book: 1, chapter: 50 }, { book: 2, chapter: 1 }, { book: 2, chapter: 2 }] }, titleOf)).toBe("Genesis 50 · Book 2 1–2");
  });

  it("lists chapters that aren't next to each other", () => {
    expect(dayLabel(plan("psalms-proverbs").days[0], titleOf)).toBe("Psalm 1, 31, 61, 91, 121 · Proverbs 1");
  });
});

describe("progress", () => {
  const p = plan("gospels-30");

  it("finds the first day not yet done, even if later ones are", () => {
    expect(nextDay(p, new Set())?.day).toBe(1);
    expect(nextDay(p, new Set([1, 2, 4]))?.day).toBe(3);
    expect(nextDay(p, new Set(p.days.map((d) => d.day)))).toBeNull();
  });

  it("counts finished days and says when it is all done", () => {
    expect(progress(p, new Set())).toEqual({ done: 0, total: 30, percent: 0, finished: false });
    expect(progress(p, new Set([1, 2, 3]))).toEqual({ done: 3, total: 30, percent: 10, finished: false });
    expect(progress(p, new Set([1, 999]))).toMatchObject({ done: 1 });
    expect(progress(p, new Set(p.days.map((d) => d.day)))).toEqual({ done: 30, total: 30, percent: 100, finished: true });
  });
});

describe("dates and streaks", () => {
  it("writes the local date", () => {
    expect(localDate(new Date(2026, 8, 5, 23, 59))).toBe("2026-09-05");
    expect(localDate(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("counts days in a row ending today", () => {
    expect(streak(["2026-09-20", "2026-09-21", "2026-09-22"], "2026-09-22")).toBe(3);
    expect(streak(["2026-09-22", "2026-09-22"], "2026-09-22")).toBe(1);
  });

  it("stays alive through today until the day is over", () => {
    expect(streak(["2026-09-20", "2026-09-21"], "2026-09-22")).toBe(2);
  });

  it("is broken by a missed day", () => {
    expect(streak(["2026-09-19", "2026-09-21"], "2026-09-22")).toBe(1);
    expect(streak(["2026-09-19", "2026-09-20"], "2026-09-22")).toBe(0);
    expect(streak([], "2026-09-22")).toBe(0);
  });

  it("crosses month and year ends", () => {
    expect(streak(["2025-12-30", "2025-12-31", "2026-01-01"], "2026-01-01")).toBe(3);
    expect(streak(["2026-02-28", "2026-03-01"], "2026-03-01")).toBe(2);
  });

  it("gathers the dates from every started plan", () => {
    const started: StartedPlan[] = [
      { plan: "a", startedOn: "2026-09-01", done: [{ day: 1, doneOn: "2026-09-01" }, { day: 2, doneOn: "2026-09-02" }] },
      { plan: "b", startedOn: "2026-09-02", done: [{ day: 1, doneOn: "2026-09-02" }] },
    ];
    expect(allDoneDates(started)).toEqual(["2026-09-01", "2026-09-02", "2026-09-02"]);
    expect(streak(allDoneDates(started), "2026-09-02")).toBe(2);
  });
});
