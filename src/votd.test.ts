/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import type { Book } from "./api";
import { parseReference } from "./reference";
import { dateKey, dayOfYear, VERSES_OF_THE_DAY, verseRefFor } from "./votd";

const DB = path.resolve(import.meta.dirname, "../src-tauri/resources/bible.db");

describe("day of year", () => {
  it("counts from 1 and handles leap years", () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1);
    expect(dayOfYear(new Date(2025, 11, 31))).toBe(365);
    expect(dayOfYear(new Date(2024, 11, 31))).toBe(366);
    expect(dayOfYear(new Date(2024, 1, 29))).toBe(60);
    expect(dayOfYear(new Date(2026, 2, 1))).toBe(60);
  });

  it("is not thrown off by the time of day", () => {
    expect(dayOfYear(new Date(2026, 5, 15, 0, 0, 1))).toBe(dayOfYear(new Date(2026, 5, 15, 23, 59, 59)));
  });
});

describe("verseRefFor", () => {
  it("gives each day of a year a different verse", () => {
    const refs = new Set<string>();
    for (let d = new Date(2024, 0, 1); d.getFullYear() === 2024; d.setDate(d.getDate() + 1)) refs.add(verseRefFor(d));
    expect(refs.size).toBe(366);
  });

  it("is stable within a day and changes at midnight", () => {
    expect(verseRefFor(new Date(2026, 8, 21, 1))).toBe(verseRefFor(new Date(2026, 8, 21, 23)));
    expect(verseRefFor(new Date(2026, 8, 21))).not.toBe(verseRefFor(new Date(2026, 8, 22)));
  });
});

describe("dateKey", () => {
  it("formats the local date", () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

// The list is only as good as its references, so check every one against the real Bible.
describe.skipIf(!fs.existsSync(DB))("the curated list", () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const books = db.prepare("SELECT id, code, name, abbrev, testament, chapters FROM books ORDER BY id").all() as unknown as Book[];

  it("covers a full leap year without repeating", () => {
    expect(VERSES_OF_THE_DAY.length).toBeGreaterThanOrEqual(366);
    expect(new Set(VERSES_OF_THE_DAY).size).toBe(VERSES_OF_THE_DAY.length);
  });

  it("names only verses that exist, each with a readable amount of text", () => {
    const problems: string[] = [];
    for (const ref of VERSES_OF_THE_DAY) {
      const parsed = parseReference(ref, books);
      if (parsed.kind !== "ref" || !parsed.verse) {
        problems.push(`${ref}: not a verse reference`);
        continue;
      }
      const rows = db
        .prepare("SELECT verse, text FROM verses WHERE translation = 'KJV' AND book = ? AND chapter = ? AND verse BETWEEN ? AND ? ORDER BY verse")
        .all(parsed.book.id, parsed.chapter, parsed.verse, parsed.verseEnd ?? parsed.verse) as { verse: number; text: string }[];
      const wanted = (parsed.verseEnd ?? parsed.verse) - parsed.verse + 1;
      const length = rows.reduce((n, r) => n + r.text.length, 0);
      if (rows.length !== wanted) problems.push(`${ref}: found ${rows.length} of ${wanted} verses`);
      else if (length > 420) problems.push(`${ref}: ${length} characters is long for a card`);
      // Names the passage the way the DB does, so a typo such as "Psalms 23" can't slip through unnoticed.
      if (parsed.book.name !== ref.replace(/ \d+:.*$/, "") && !(parsed.book.code === "PSA" && ref.startsWith("Psalm "))) {
        problems.push(`${ref}: resolves to ${parsed.book.name}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
