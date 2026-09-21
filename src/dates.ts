/** Parses SQLite's UTC `CURRENT_TIMESTAMP` ("2026-09-21 12:00:00"). Returns null if it isn't one. */
export function parseTimestamp(at: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(at);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, s));
}

/** "Sep 21", or "Sep 21, 2025" when it isn't this year. */
export function formatDate(at: string, now: Date = new Date(), locale?: string): string {
  const date = parseTimestamp(at);
  if (!date) return "";
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(locale, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
