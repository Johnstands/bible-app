import { loadJson, saveJson } from "./storage";

// A curated list rather than a random verse, so a day never lands on a genealogy or a census.
// Written as references so they read naturally; each is checked against the Bible in votd.test.ts.
export const VERSES_OF_THE_DAY = [
  "Genesis 1:1", "Genesis 1:27", "Genesis 2:24", "Genesis 8:22", "Genesis 12:2-3", "Genesis 15:1",
  "Genesis 18:14", "Genesis 28:15", "Genesis 32:28", "Genesis 50:20", "Exodus 3:14", "Exodus 14:14",
  "Exodus 15:2", "Exodus 20:8", "Exodus 33:14", "Exodus 34:6", "Leviticus 19:18", "Numbers 6:24-26",
  "Numbers 23:19", "Deuteronomy 6:4-5", "Deuteronomy 7:9", "Deuteronomy 10:12", "Deuteronomy 31:6",
  "Deuteronomy 33:27", "Joshua 1:9", "Joshua 24:15", "Judges 6:12", "Ruth 1:16", "1 Samuel 2:2",
  "1 Samuel 12:24", "1 Samuel 16:7", "2 Samuel 22:31", "1 Kings 8:56", "1 Kings 19:12",
  "1 Chronicles 16:34", "1 Chronicles 29:11", "2 Chronicles 7:14", "2 Chronicles 16:9", "Ezra 7:10",
  "Nehemiah 8:10", "Esther 4:14", "Job 1:21", "Job 19:25", "Job 23:10", "Job 42:2", "Psalm 1:1-2",
  "Psalm 4:8", "Psalm 8:3-4", "Psalm 9:1", "Psalm 16:11", "Psalm 18:2", "Psalm 19:1", "Psalm 19:14",
  "Psalm 20:7", "Psalm 23:1-3", "Psalm 23:4", "Psalm 24:1", "Psalm 25:4-5", "Psalm 27:1", "Psalm 27:14",
  "Psalm 29:11", "Psalm 30:5", "Psalm 31:24", "Psalm 32:8", "Psalm 33:4", "Psalm 34:8", "Psalm 34:18",
  "Psalm 36:5", "Psalm 37:4", "Psalm 37:5", "Psalm 40:1-2", "Psalm 42:1", "Psalm 43:5", "Psalm 46:1",
  "Psalm 46:10", "Psalm 51:10", "Psalm 55:22", "Psalm 56:3", "Psalm 57:1", "Psalm 61:2", "Psalm 62:1",
  "Psalm 63:1", "Psalm 66:16", "Psalm 68:19", "Psalm 71:5", "Psalm 73:26", "Psalm 84:11", "Psalm 86:5",
  "Psalm 89:1", "Psalm 90:12", "Psalm 91:1-2", "Psalm 91:11", "Psalm 92:1", "Psalm 94:19", "Psalm 95:6",
  "Psalm 96:3", "Psalm 100:4-5", "Psalm 103:1-2", "Psalm 103:12", "Psalm 105:1", "Psalm 107:1",
  "Psalm 111:10", "Psalm 115:1", "Psalm 116:1-2", "Psalm 118:24", "Psalm 119:11", "Psalm 119:105",
  "Psalm 119:130", "Psalm 121:1-2", "Psalm 121:7-8", "Psalm 122:1", "Psalm 126:5", "Psalm 127:1",
  "Psalm 130:5", "Psalm 133:1", "Psalm 136:1", "Psalm 138:8", "Psalm 139:14", "Psalm 139:23-24",
  "Psalm 143:8", "Psalm 145:18", "Psalm 146:5", "Psalm 147:3", "Psalm 150:6", "Proverbs 1:7",
  "Proverbs 2:6", "Proverbs 3:5-6", "Proverbs 4:23", "Proverbs 9:10", "Proverbs 10:12", "Proverbs 11:25",
  "Proverbs 12:25", "Proverbs 14:26", "Proverbs 15:1", "Proverbs 16:3", "Proverbs 16:9", "Proverbs 17:17",
  "Proverbs 18:10", "Proverbs 18:21", "Proverbs 19:21", "Proverbs 22:6", "Proverbs 27:17",
  "Proverbs 31:25", "Ecclesiastes 3:1", "Ecclesiastes 3:11", "Ecclesiastes 4:9-10", "Ecclesiastes 12:13",
  "Song of Solomon 2:11-12", "Song of Solomon 8:7", "Isaiah 1:18", "Isaiah 6:8", "Isaiah 9:6",
  "Isaiah 12:2", "Isaiah 26:3", "Isaiah 30:15", "Isaiah 40:8", "Isaiah 40:28-29", "Isaiah 40:31",
  "Isaiah 41:10", "Isaiah 43:1-2", "Isaiah 43:19", "Isaiah 46:4", "Isaiah 53:5", "Isaiah 53:6",
  "Isaiah 54:10", "Isaiah 55:6-7", "Isaiah 55:8-9", "Isaiah 55:11", "Isaiah 58:11", "Isaiah 61:1",
  "Jeremiah 1:5", "Jeremiah 9:23-24", "Jeremiah 17:7-8", "Jeremiah 29:11", "Jeremiah 29:13",
  "Jeremiah 31:3", "Jeremiah 32:17", "Jeremiah 33:3", "Lamentations 3:22-23", "Lamentations 3:25",
  "Ezekiel 34:11", "Ezekiel 36:26", "Daniel 3:17-18", "Daniel 12:3", "Hosea 6:3", "Hosea 10:12",
  "Joel 2:13", "Joel 2:28", "Amos 5:24", "Jonah 2:2", "Micah 5:2", "Micah 6:8", "Nahum 1:7",
  "Habakkuk 2:4", "Habakkuk 3:17-18", "Zephaniah 3:17", "Haggai 2:9", "Zechariah 4:6", "Zechariah 9:9",
  "Malachi 3:10", "Malachi 4:2", "Matthew 1:21", "Matthew 4:4", "Matthew 4:19", "Matthew 5:3-4",
  "Matthew 5:6", "Matthew 5:8", "Matthew 5:9", "Matthew 5:14-16", "Matthew 5:44", "Matthew 6:9-10",
  "Matthew 6:19-20", "Matthew 6:21", "Matthew 6:26", "Matthew 6:33", "Matthew 6:34", "Matthew 7:7",
  "Matthew 7:12", "Matthew 7:24", "Matthew 10:29-31", "Matthew 11:28-30", "Matthew 16:24",
  "Matthew 18:20", "Matthew 19:26", "Matthew 22:37-39", "Matthew 28:19-20", "Mark 1:15", "Mark 9:23",
  "Mark 10:45", "Mark 11:24", "Mark 12:30", "Mark 16:15", "Luke 1:37", "Luke 1:46-47", "Luke 2:10-11",
  "Luke 2:14", "Luke 6:31", "Luke 6:37", "Luke 6:38", "Luke 10:27", "Luke 11:9", "Luke 12:34",
  "Luke 15:7", "Luke 18:27", "Luke 19:10", "Luke 24:5-6", "John 1:1", "John 1:5", "John 1:12",
  "John 1:14", "John 3:16", "John 3:17", "John 4:24", "John 5:24", "John 6:35", "John 8:12", "John 8:32",
  "John 10:10", "John 10:11", "John 10:27-28", "John 11:25-26", "John 13:34-35", "John 14:2-3",
  "John 14:6", "John 14:27", "John 15:5", "John 15:13", "John 16:33", "John 17:3", "John 20:29",
  "Acts 1:8", "Acts 2:38", "Acts 4:12", "Acts 16:31", "Acts 17:28", "Acts 20:35", "Romans 1:16",
  "Romans 3:23", "Romans 5:1", "Romans 5:8", "Romans 6:23", "Romans 8:1", "Romans 8:18", "Romans 8:28",
  "Romans 8:31", "Romans 8:38-39", "Romans 10:9", "Romans 10:17", "Romans 12:1", "Romans 12:2",
  "Romans 12:12", "Romans 12:21", "Romans 15:4", "Romans 15:13", "1 Corinthians 1:18",
  "1 Corinthians 2:9", "1 Corinthians 6:19-20", "1 Corinthians 10:13", "1 Corinthians 13:4-7",
  "1 Corinthians 13:13", "1 Corinthians 15:57-58", "1 Corinthians 16:13-14", "2 Corinthians 1:3-4",
  "2 Corinthians 4:17-18", "2 Corinthians 5:7", "2 Corinthians 5:17", "2 Corinthians 9:7",
  "2 Corinthians 12:9", "Galatians 2:20", "Galatians 5:22-23", "Galatians 6:9", "Ephesians 2:8-9",
  "Ephesians 3:20", "Ephesians 4:32", "Ephesians 6:10", "Ephesians 6:18", "Philippians 1:6",
  "Philippians 2:3-4", "Philippians 3:13-14", "Philippians 4:4", "Philippians 4:6-7", "Philippians 4:8",
  "Philippians 4:13", "Philippians 4:19", "Colossians 2:6-7", "Colossians 3:2", "Colossians 3:12",
  "Colossians 3:23", "1 Thessalonians 5:16-18", "2 Thessalonians 3:3", "1 Timothy 4:12", "1 Timothy 6:6",
  "2 Timothy 1:7", "2 Timothy 3:16-17", "Titus 2:11", "Hebrews 4:12", "Hebrews 4:16", "Hebrews 6:19",
  "Hebrews 10:23", "Hebrews 11:1", "Hebrews 11:6", "Hebrews 12:1-2", "Hebrews 13:5", "Hebrews 13:8",
  "James 1:2-3", "James 1:5", "James 1:22", "James 3:17", "James 4:7-8", "James 5:16", "1 Peter 2:9",
  "1 Peter 3:15", "1 Peter 4:8", "1 Peter 5:7", "2 Peter 1:3", "2 Peter 3:9", "1 John 1:9", "1 John 3:1",
  "1 John 4:4", "1 John 4:7-8", "1 John 4:19", "1 John 5:14", "3 John 1:4", "Jude 1:24-25",
  "Revelation 1:8", "Revelation 3:20", "Revelation 5:12", "Revelation 21:4", "Revelation 21:5",
  "Revelation 22:17",
];

/** 1 for January 1st through 365 (366 in a leap year), by the local calendar date. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getFullYear(), 0, 0);
  const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((today - start) / 86_400_000);
}

/** The reference for `date`. Every day of a year gets a different verse, and it never changes for a given day. */
export function verseRefFor(date: Date): string {
  return VERSES_OF_THE_DAY[(dayOfYear(date) - 1) % VERSES_OF_THE_DAY.length];
}

/** "2026-09-21" in local time, used to show the verse only once a day. */
export function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const hasSeenVerseToday = (date: Date) => loadJson<string>("votdSeen") === dateKey(date);
export const markVerseSeen = (date: Date) => saveJson("votdSeen", dateKey(date));
