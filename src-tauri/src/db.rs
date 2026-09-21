//! SQLite access: the read-only bundled Bible DB and the writable per-user DB.

use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("{0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Path(#[from] tauri::Error),
    #[error("{0}")]
    Invalid(String),
}

// Tauri commands need a serializable error; the message is all the UI needs.
impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Serialize)]
pub struct Translation {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct Book {
    pub id: u32,
    pub code: String,
    pub name: String,
    pub abbrev: String,
    pub testament: String,
    pub chapters: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verse {
    pub verse: u32,
    /// Set when the source merges several verses into one (e.g. "15-16").
    pub verse_end: Option<u32>,
    pub text: String,
    /// The enclosing block: `p` (prose paragraph) or `q` (poetry line).
    pub kind: String,
    /// True when this verse opens a new paragraph or poetry line.
    pub new_block: bool,
    /// True when a stanza break (blank line) precedes this verse.
    pub gap: bool,
    /// A heading shown before the verse: a Psalm title or a section heading.
    pub heading: Option<String>,
    /// `title` or `section`, set whenever `heading` is.
    pub heading_kind: Option<String>,
    /// A closing note shown after the verse (an epistle's subscription).
    pub subscription: Option<String>,
}

/// Characters wrapped around matched words in `SearchHit::snippet`; the UI turns them into highlights.
pub const MATCH_START: char = '\u{1}';
pub const MATCH_END: char = '\u{2}';

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub translation: String,
    pub book: u32,
    pub book_name: String,
    pub chapter: u32,
    pub verse: u32,
    /// The verse text (shortened around the match for long verses) with matched words
    /// wrapped in `MATCH_START` / `MATCH_END`.
    pub snippet: String,
}

#[derive(Debug, Serialize)]
pub struct SearchResults {
    /// How many verses match in all, ignoring `limit` and `offset`.
    pub total: u32,
    pub hits: Vec<SearchHit>,
}

/// Narrows a search. All fields are optional and combine with AND.
#[derive(Debug, Default)]
pub struct SearchFilter<'a> {
    pub translation: Option<&'a str>,
    /// `OT` or `NT`.
    pub testament: Option<&'a str>,
    pub book: Option<u32>,
}

/// Opens the bundled Bible DB read-only.
pub fn open_bible(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

pub fn list_translations(conn: &Connection) -> Result<Vec<Translation>> {
    let mut stmt = conn.prepare("SELECT id, name FROM translations ORDER BY id")?;
    let rows = stmt.query_map([], |r| Ok(Translation { id: r.get(0)?, name: r.get(1)? }))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn list_books(conn: &Connection) -> Result<Vec<Book>> {
    let mut stmt =
        conn.prepare("SELECT id, code, name, abbrev, testament, chapters FROM books ORDER BY id")?;
    let rows = stmt.query_map([], |r| {
        Ok(Book {
            id: r.get(0)?,
            code: r.get(1)?,
            name: r.get(2)?,
            abbrev: r.get(3)?,
            testament: r.get(4)?,
            chapters: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The text of one verse, or of `verse..=verse_end`, joined with spaces. Empty if it doesn't exist.
pub fn verse_text(
    conn: &Connection,
    translation: &str,
    book: u32,
    chapter: u32,
    verse: u32,
    verse_end: Option<u32>,
) -> Result<String> {
    let mut stmt = conn.prepare_cached(
        "SELECT text FROM verses
         WHERE translation = ?1 AND book = ?2 AND chapter = ?3 AND verse BETWEEN ?4 AND ?5
         ORDER BY verse",
    )?;
    let end = verse_end.unwrap_or(verse).max(verse);
    let rows = stmt.query_map(params![translation, book, chapter, verse, end], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?.join(" "))
}

pub fn get_chapter(
    conn: &Connection,
    translation: &str,
    book: u32,
    chapter: u32,
) -> Result<Vec<Verse>> {
    let mut stmt = conn.prepare_cached(
        "SELECT verse, verse_end, text, kind, new_block, gap, heading, heading_kind, subscription
         FROM verses
         WHERE translation = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse",
    )?;
    let rows = stmt.query_map(params![translation, book, chapter], |r| {
        Ok(Verse {
            verse: r.get(0)?,
            verse_end: r.get(1)?,
            text: r.get(2)?,
            kind: r.get(3)?,
            new_block: r.get(4)?,
            gap: r.get(5)?,
            heading: r.get(6)?,
            heading_kind: r.get(7)?,
            subscription: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

enum Term<'a> {
    Word(&'a str),
    Phrase(String),
}

/// Turns free text into a safe FTS5 query. Every word is quoted, so FTS syntax characters
/// typed by the user are inert; words in double quotes become an exact phrase; and a trailing
/// bare word matches as a prefix, so results appear while it is still being typed.
/// Returns `None` if the input has no searchable words.
fn fts_query(input: &str) -> Option<String> {
    let mut terms = Vec::new();
    // Splitting on `"` puts quoted text at the odd positions; an unclosed quote runs to the end.
    for (i, segment) in input.split('"').enumerate() {
        let words = segment.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty());
        if i % 2 == 1 {
            let phrase = words.collect::<Vec<_>>().join(" ");
            if !phrase.is_empty() {
                terms.push(Term::Phrase(phrase));
            }
        } else {
            terms.extend(words.map(Term::Word));
        }
    }
    let last = terms.len().checked_sub(1)?;
    let parts: Vec<String> = terms
        .iter()
        .enumerate()
        .map(|(i, t)| match t {
            Term::Word(w) if i == last => format!("\"{w}\"*"),
            Term::Word(w) => format!("\"{w}\""),
            Term::Phrase(p) => format!("\"{p}\""),
        })
        .collect();
    Some(parts.join(" "))
}

const SEARCH_FROM_WHERE: &str = "
    FROM verses_fts
    JOIN verses v ON v.id = verses_fts.rowid
    JOIN books b ON b.id = v.book
    WHERE verses_fts MATCH ?1
      AND (?2 IS NULL OR v.translation = ?2)
      AND (?3 IS NULL OR b.testament = ?3)
      AND (?4 IS NULL OR v.book = ?4)";

/// Full-text search, best matches first, with the total number of matches for paging.
pub fn search(
    conn: &Connection,
    query: &str,
    filter: &SearchFilter,
    limit: u32,
    offset: u32,
) -> Result<SearchResults> {
    let Some(q) = fts_query(query) else {
        return Ok(SearchResults { total: 0, hits: Vec::new() });
    };
    let filters = params![q, filter.translation, filter.testament, filter.book];

    let total = conn
        .prepare_cached(&format!("SELECT COUNT(*) {SEARCH_FROM_WHERE}"))?
        .query_row(filters, |r| r.get(0))?;

    let mut stmt = conn.prepare_cached(&format!(
        "SELECT v.translation, v.book, b.name, v.chapter, v.verse,
                snippet(verses_fts, 0, char(1), char(2), '…', 32)
         {SEARCH_FROM_WHERE}
         ORDER BY verses_fts.rank
         LIMIT ?5 OFFSET ?6"
    ))?;
    let rows = stmt.query_map(params![q, filter.translation, filter.testament, filter.book, limit, offset], |r| {
        Ok(SearchHit {
            translation: r.get(0)?,
            book: r.get(1)?,
            book_name: r.get(2)?,
            chapter: r.get(3)?,
            verse: r.get(4)?,
            snippet: r.get(5)?,
        })
    })?;
    Ok(SearchResults { total, hits: rows.collect::<rusqlite::Result<_>>()? })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bible() -> Connection {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/bible.db");
        assert!(path.exists(), "missing {path:?}: run `npm run data:fetch && npm run data:build`");
        open_bible(&path).unwrap()
    }

    #[test]
    fn fts_query_quotes_words_and_prefixes_the_last() {
        assert_eq!(fts_query("love thy neigh").unwrap(), r#""love" "thy" "neigh"*"#);
        assert_eq!(fts_query("  shepherd ").unwrap(), r#""shepherd"*"#);
    }

    #[test]
    fn fts_query_keeps_quoted_words_together() {
        assert_eq!(fts_query(r#""in the beginning""#).unwrap(), r#""in the beginning""#);
        // Only a trailing bare word is a prefix; a closing phrase is left exact.
        assert_eq!(fts_query(r#"god "in the beginning" cre"#).unwrap(), r#""god" "in the beginning" "cre"*"#);
        assert_eq!(fts_query(r#""unclosed phrase"#).unwrap(), r#""unclosed phrase""#);
        assert_eq!(fts_query(r#""!!!" word"#).unwrap(), r#""word"*"#);
    }

    #[test]
    fn fts_query_neutralizes_fts_syntax() {
        assert_eq!(fts_query(r#""a" OR -b* (c)"#).unwrap(), r#""a" "OR" "b" "c"*"#);
        assert_eq!(fts_query(r#""" -- ()"#), None);
        assert_eq!(fts_query(""), None);
    }

    #[test]
    fn lists_books_and_translations() {
        let conn = bible();
        let books = list_books(&conn).unwrap();
        assert_eq!(books.len(), 66);
        assert_eq!((books[0].name.as_str(), books[0].testament.as_str()), ("Genesis", "OT"));
        assert_eq!((books[42].name.as_str(), books[42].chapters), ("John", 21));
        let ids: Vec<_> = list_translations(&conn).unwrap().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["KJV"]);
    }

    #[test]
    fn returns_a_whole_chapter_in_order() {
        let conn = bible();
        let john3 = get_chapter(&conn, "KJV", 43, 3).unwrap();
        assert_eq!(john3.len(), 36);
        assert_eq!(john3[15].verse, 16);
        assert!(john3[15].text.starts_with("For God so loved the world"));
        assert!(john3.windows(2).all(|w| w[0].verse < w[1].verse));
        let psalm119 = get_chapter(&conn, "KJV", 19, 119).unwrap();
        assert_eq!(psalm119.len(), 176);
        assert!(get_chapter(&conn, "KJV", 43, 99).unwrap().is_empty());
        assert!(get_chapter(&conn, "NOPE", 43, 3).unwrap().is_empty());
    }

    #[test]
    fn verse_text_returns_one_verse_or_a_joined_range() {
        let conn = bible();
        let one = verse_text(&conn, "KJV", 43, 3, 16, None).unwrap();
        assert!(one.starts_with("For God so loved the world"));
        let two = verse_text(&conn, "KJV", 43, 3, 16, Some(17)).unwrap();
        assert!(two.starts_with(&one) && two.contains("For God sent not his Son"));
        // A reversed range is treated as a single verse, and missing verses give an empty string.
        assert_eq!(verse_text(&conn, "KJV", 43, 3, 16, Some(3)).unwrap(), one);
        assert_eq!(verse_text(&conn, "KJV", 43, 3, 99, None).unwrap(), "");
    }

    #[test]
    fn prose_chapters_carry_paragraph_breaks() {
        let conn = bible();
        let john3 = get_chapter(&conn, "KJV", 43, 3).unwrap();
        assert!(john3.iter().all(|v| v.kind == "p" && !v.gap));
        assert!(john3[0].new_block && !john3[1].new_block);
        assert!(john3[15].new_block); // "For God so loved the world" opens a paragraph
    }

    #[test]
    fn psalms_carry_poetry_titles_and_stanzas() {
        let conn = bible();
        let ps3 = get_chapter(&conn, "KJV", 19, 3).unwrap();
        assert!(ps3.iter().all(|v| v.kind == "q" && v.new_block));
        assert_eq!(ps3[0].heading.as_deref(), Some("A Psalm of David, when he fled from Absalom his son."));
        assert_eq!(ps3[0].heading_kind.as_deref(), Some("title"));
        assert!(ps3[3].gap && !ps3[2].gap); // stanza break before verse 4

        let ps119 = get_chapter(&conn, "KJV", 19, 119).unwrap();
        assert_eq!(ps119[8].heading.as_deref(), Some("ב BETH.")); // verse 9
        assert_eq!(ps119[8].heading_kind.as_deref(), Some("section"));
    }

    #[test]
    fn epistle_subscriptions_attach_to_the_last_verse() {
        let conn = bible();
        let rom16 = get_chapter(&conn, "KJV", 45, 16).unwrap();
        let last = rom16.last().unwrap();
        assert!(last.subscription.as_deref().unwrap().starts_with("Written to the Romans"));
        assert!(rom16.iter().rev().skip(1).all(|v| v.subscription.is_none()));
        // ...and not on the first verse of the next book.
        assert!(get_chapter(&conn, "KJV", 46, 1).unwrap()[0].heading.is_none());
    }

    fn hits(conn: &Connection, q: &str, filter: &SearchFilter, limit: u32) -> SearchResults {
        search(conn, q, filter, limit, 0).unwrap_or_else(|e| panic!("query {q:?} failed: {e}"))
    }

    fn reference(h: &SearchHit) -> (&str, u32, u32) {
        (h.book_name.as_str(), h.chapter, h.verse)
    }

    /// Removes the highlight markers, leaving the plain text.
    fn plain(snippet: &str) -> String {
        snippet.replace([MATCH_START, MATCH_END], "")
    }

    #[test]
    fn search_finds_verses_and_respects_translation_filter() {
        let conn = bible();
        let kjv = SearchFilter { translation: Some("KJV"), ..Default::default() };
        let r = hits(&conn, "The LORD is my shepherd", &kjv, 10);
        assert_eq!(reference(&r.hits[0]), ("Psalms", 23, 1));
        assert!(r.hits.iter().all(|h| h.translation == "KJV"));

        let none = SearchFilter { translation: Some("NOPE"), ..Default::default() };
        assert_eq!(hits(&conn, "shepherd", &none, 10).total, 0);

        // Stemming and prefix matching: "loving kind" finds "lovingkindness".
        assert!(hits(&conn, "loving kind", &kjv, 5).total > 0);
        assert_eq!(hits(&conn, "shepherd", &SearchFilter::default(), 3).hits.len(), 3);
    }

    #[test]
    fn quoted_words_match_as_an_exact_phrase() {
        let conn = bible();
        let all = SearchFilter::default();
        let phrase = hits(&conn, "\"in the beginning\"", &all, 50);
        let loose = hits(&conn, "in the beginning", &all, 50);
        assert!(phrase.total > 0 && phrase.total < loose.total);
        assert!(phrase.hits.iter().all(|h| plain(&h.snippet).to_lowercase().contains("in the beginning")));
        assert_eq!(reference(&hits(&conn, "\"in the beginning god created\"", &all, 5).hits[0]), ("Genesis", 1, 1));
    }

    #[test]
    fn snippets_wrap_matched_words_in_markers() {
        let conn = bible();
        let r = hits(&conn, "shepherd", &SearchFilter::default(), 20);
        for h in &r.hits {
            assert_eq!(h.snippet.matches(MATCH_START).count(), h.snippet.matches(MATCH_END).count());
            assert!(h.snippet.contains(MATCH_START), "no match marked in {:?}", h.snippet);
        }
        // Stemming: the query "love" also marks "loved", "loveth" and so on.
        let love = hits(&conn, "love", &SearchFilter::default(), 200);
        assert!(love.hits.iter().any(|h| h.snippet.to_lowercase().contains("\u{1}loved\u{2}")));
    }

    #[test]
    fn filters_narrow_by_testament_and_book() {
        let conn = bible();
        let count = |f: SearchFilter| hits(&conn, "shepherd", &f, 500);
        let all = count(SearchFilter::default());
        let ot = count(SearchFilter { testament: Some("OT"), ..Default::default() });
        let nt = count(SearchFilter { testament: Some("NT"), ..Default::default() });
        assert!(ot.total > 0 && nt.total > 0);
        assert_eq!(ot.total + nt.total, all.total);
        assert!(nt.hits.iter().all(|h| h.book >= 40));
        assert!(ot.hits.iter().all(|h| h.book < 40));

        let psalms = count(SearchFilter { book: Some(19), ..Default::default() });
        assert!(psalms.total > 0 && psalms.hits.iter().all(|h| h.book == 19));
        // A book outside the chosen testament matches nothing.
        assert_eq!(count(SearchFilter { testament: Some("NT"), book: Some(19), ..Default::default() }).total, 0);
    }

    #[test]
    fn paging_returns_disjoint_pages_and_a_stable_total() {
        let conn = bible();
        let all = SearchFilter::default();
        let first = search(&conn, "lord", &all, 20, 0).unwrap();
        let second = search(&conn, "lord", &all, 20, 20).unwrap();
        assert_eq!(first.total, second.total);
        assert!(first.total > 40);
        let key = |h: &SearchHit| (h.book, h.chapter, h.verse);
        assert!(first.hits.iter().all(|a| second.hits.iter().all(|b| key(a) != key(b))));
        assert!(search(&conn, "lord", &all, 20, first.total).unwrap().hits.is_empty());
    }

    #[test]
    fn search_never_errors_on_odd_input() {
        let conn = bible();
        for q in ["", "   ", "\"", "\"\"", "\"unclosed phrase", "AND OR NOT", "NEAR(", "a -b", "col:on", "*", "'; DROP TABLE verses;--"] {
            hits(&conn, q, &SearchFilter::default(), 5);
        }
    }

    // The plan's bar for Phase 3 is 100 ms. Ranking dominates and scales with the number of matches
    // ("the" matches 27k verses), and an unoptimized test build runs about 4x slower than the shipped
    // one, so debug builds get a looser bound; `cargo test --release` enforces the real one.
    #[test]
    fn search_is_fast() {
        let conn = bible();
        let all = SearchFilter::default();
        let nt = SearchFilter { testament: Some("NT"), ..Default::default() };
        for (q, f) in [
            ("the", &all), ("lord", &all), ("and the lord said unto", &all), ("love thy neighbour", &all),
            ("\"in the beginning\"", &all), ("shep", &all), ("jesus", &nt), ("z", &all),
        ] {
            search(&conn, q, f, 50, 0).unwrap(); // warm the statement cache and page cache
            let start = std::time::Instant::now();
            let r = search(&conn, q, f, 50, 0).unwrap();
            let elapsed = start.elapsed();
            eprintln!("{q:?}: {} matches in {elapsed:?}", r.total);
            let limit_ms = if cfg!(debug_assertions) { 400 } else { 100 };
            assert!(elapsed.as_millis() < limit_ms, "{q:?} took {elapsed:?} (limit {limit_ms} ms)");
        }
    }
}
