/// <reference types="node" />
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Book } from "./api";
import { annotate, buildIndex, parseGlossary, verseKey } from "./glossary";
import type { GlossaryIndex } from "./glossary";
import { parseReference } from "./reference";

const ROOT = path.resolve(import.meta.dirname, "..");
const DB = path.join(ROOT, "src-tauri/resources/bible.db");
const GLOSSARY = path.join(ROOT, "data/glossary.txt");

describe("parseGlossary", () => {
  it("reads entries, comments and optional fields", () => {
    const entries = parseGlossary(
      [
        "# a comment",
        "",
        "whither | archaic | to what place",
        "prevent, prevented | changed | go before | Today: stop",
        "let | changed | hinder | | @ Exodus 5:4; Isaiah 43:13",
        "his seed | changed | offspring | | @! Luke 8:5",
      ].join("\n"),
    );
    expect(entries.map((e) => [e.forms, e.kind, e.today, e.verses, e.except])).toEqual([
      [["whither"], "archaic", null, null, false],
      [["prevent", "prevented"], "changed", "stop", null, false],
      [["let"], "changed", null, ["Exodus 5:4", "Isaiah 43:13"], false],
      [["his seed"], "changed", null, ["Luke 8:5"], true],
    ]);
    expect(entries[0].line).toBe(3);
  });

  it("names the line of a malformed entry", () => {
    for (const [line, why] of [
      ["Whither | archaic | x", /lowercase/],
      ["whither | oldish | x", /kind/],
      ["whither | archaic |", /meaning/],
      ["whither | archaic | x | | Exodus 5:4", /@/],
      ["whither | archaic | x | | @", /empty verse list/],
      ["whither | archaic | x | | @ a | extra", /too many/],
    ] as const) {
      expect(() => parseGlossary(`# header\n${line}`)).toThrow(why);
      expect(() => parseGlossary(`# header\n${line}`)).toThrow(/line 2/);
    }
  });
});

// The rest run against the real Bible, so they can only be as good as the data they check.
describe.skipIf(!fs.existsSync(DB))("the glossary against the Bible", () => {
  const db = new DatabaseSync(DB, { readOnly: true });
  const books = db.prepare("SELECT id, code, name, abbrev, testament, chapters FROM books ORDER BY id").all() as unknown as Book[];
  const verses = db.prepare("SELECT book, chapter, verse, text FROM verses WHERE translation = 'KJV' ORDER BY id").all() as {
    book: number; chapter: number; verse: number; text: string;
  }[];
  const entries = parseGlossary(fs.readFileSync(GLOSSARY, "utf8"));
  const index: GlossaryIndex = buildIndex(entries, books);
  const textOf = (ref: string) => {
    const r = parseReference(ref, books);
    if (r.kind !== "ref" || !r.verse) throw new Error(`bad reference ${ref}`);
    return verses.find((v) => v.book === r.book.id && v.chapter === r.chapter && v.verse === r.verse)?.text ?? "";
  };
  const has = (text: string, form: string) => new RegExp(`(?<![A-Za-z-])${form.replace(/ /g, "\\s+")}(?![A-Za-z-])`, "i").test(text);

  it("has a substantial, well-formed list", () => {
    expect(entries.length).toBeGreaterThan(500);
    expect(entries.every((e) => e.meaning.length > 0)).toBe(true);
  });

  it("explains only forms that really occur in the KJV", () => {
    const all = verses.map((v) => v.text).join("\n");
    const missing = entries.flatMap((e) => e.forms.filter((f) => !has(all, f)).map((f) => `${f} (line ${e.line})`));
    expect(missing).toEqual([]);
  });

  it("lists, for a verse-scoped entry, only verses that contain one of its words", () => {
    const wrong: string[] = [];
    for (const e of entries.filter((x) => x.verses)) {
      for (const ref of e.verses!) {
        if (!e.forms.some((f) => has(textOf(ref), f))) wrong.push(`${ref} has none of ${e.forms.join("/")} (line ${e.line})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("never lets two entries claim the same word in the same verse", () => {
    const clashes: string[] = [];
    const byForm = new Map<string, typeof entries>();
    for (const e of entries) for (const f of e.forms) byForm.set(f, [...(byForm.get(f) ?? []), e]);
    for (const [form, list] of byForm) {
      if (list.length < 2) continue;
      const unscoped = list.filter((e) => !e.verses);
      if (unscoped.length > 1) clashes.push(`${form}: defined twice without a scope`);
      const scoped = list.filter((e) => e.verses && !e.except);
      const seen = new Map<string, number>();
      for (const e of scoped) for (const v of e.verses!) {
        const line = seen.get(v);
        if (line !== undefined) clashes.push(`${form}: ${v} is in lines ${line} and ${e.line}`);
        seen.set(v, e.line);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("annotates whole words, in the right verses only", () => {
    const at = (ref: string) => {
      const r = parseReference(ref, books);
      if (r.kind !== "ref" || !r.verse) throw new Error(ref);
      return annotate(textOf(ref), verseKey(r.book.id, r.chapter, r.verse), index).filter((s) => s.entry).map((s) => s.text.toLowerCase());
    };
    expect(at("Genesis 2:18")).toContain("meet"); // "an help meet for him"
    expect(at("Genesis 46:29")).not.toContain("meet"); // "to meet Israel his father"
    expect(at("Exodus 5:4")).toContain("let"); // "let the people from their works"
    expect(at("Genesis 1:3")).not.toContain("let"); // "Let there be light"
    expect(at("Matthew 19:14")).toContain("suffer");
    expect(at("Matthew 16:21")).not.toContain("suffer"); // "suffer many things"
    expect(at("Romans 8:28")).not.toContain("whole");
    expect(at("Matthew 9:22")).toContain("whole");
    expect(at("Genesis 15:18")).toContain("thy seed"); // descendants
    expect(at("Deuteronomy 14:22")).not.toContain("thy seed"); // grain
    expect(at("Ephesians 4:32")).not.toContain("prevent");
    // "without" means "outside" in some verses and "lacking" in the rest.
    expect(at("Matthew 12:46")).toContain("without"); // "his brethren stood without"
    expect(at("1 Corinthians 5:12")).toContain("without"); // "them that are without"
    expect(at("Leviticus 1:3")).not.toContain("without"); // "without blemish"
    expect(at("Ephesians 2:12")).not.toContain("without"); // "without Christ"
    expect(at("Proverbs 25:28")).not.toContain("without"); // "a city ... without walls" = lacking walls
    expect(at("Mark 7:18")).toEqual(["from without"]); // not the "without understanding" in the same verse
    expect(at("Psalms 119:147")).toContain("prevented");
  });

  it("skips pieces of hyphenated names and names that are not the common word", () => {
    const one = (text: string) => annotate(text, "0:0:0", index).filter((s) => s.entry).map((s) => s.text);
    expect(one("And Bath-sheba bare a son")).toEqual([]);
    expect(one("Hanniel the son of Ephod")).toEqual([]);
    expect(one("a linen ephod, and a girdle")).toEqual(["ephod", "girdle"]);
    expect(one("Verily, verily, I say unto you")).toEqual(["Verily", "verily"]);
    expect(one("Selah.")).toEqual(["Selah"]);
  });

  it("prefers the longer phrase and keeps the surrounding text intact", () => {
    const text = "Bid him God speed: I pray thee, by and by.";
    const segments = annotate(text, "0:0:0", index);
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.filter((s) => s.entry).map((s) => s.text)).toEqual(["God speed", "I pray thee", "by and by"]);
  });

  it("finds a usable amount of help in a typical chapter", () => {
    const count = (book: number, chapter: number) =>
      verses.filter((v) => v.book === book && v.chapter === chapter).reduce(
        (n, v) => n + annotate(v.text, verseKey(v.book, v.chapter, v.verse), index).filter((s) => s.entry).length, 0);
    expect(count(43, 3)).toBeGreaterThan(0); // John 3
    expect(count(19, 23)).toBeGreaterThan(0); // Psalm 23
    expect(count(19, 23)).toBeLessThan(15);
  });
});
