import { describe, expect, it } from "vitest";
import { formatDate, parseTimestamp } from "./dates";

describe("parseTimestamp", () => {
  it("reads SQLite UTC timestamps", () => {
    expect(parseTimestamp("2026-09-21 12:30:05")?.toISOString()).toBe("2026-09-21T12:30:05.000Z");
  });
  it("rejects anything else", () => {
    for (const s of ["", "2026-09-21", "2026-09-21T12:30:05Z", "yesterday"]) expect(parseTimestamp(s)).toBeNull();
  });
});

describe("formatDate", () => {
  const now = new Date(2026, 8, 21, 12);
  it("leaves out the year for this year", () => {
    expect(formatDate("2026-03-05 12:00:00", now, "en-US")).toBe("Mar 5");
  });
  it("includes the year for other years", () => {
    expect(formatDate("2025-03-05 12:00:00", now, "en-US")).toBe("Mar 5, 2025");
  });
  it("is empty for a bad timestamp", () => {
    expect(formatDate("nope", now, "en-US")).toBe("");
  });
});
