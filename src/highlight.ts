// The backend wraps matched words in these control characters (see `MATCH_START` in db.rs).
const START = "\u0001";
const END = "\u0002";

export interface Segment {
  text: string;
  match: boolean;
}

/** Splits a search snippet into plain and matched runs, so it can be rendered without HTML. */
export function splitMarks(snippet: string): Segment[] {
  const segments: Segment[] = [];
  let match = false;
  for (const part of snippet.split(/([\u0001\u0002])/)) {
    if (part === START) match = true;
    else if (part === END) match = false;
    else if (part) segments.push({ text: part, match });
  }
  return segments;
}
