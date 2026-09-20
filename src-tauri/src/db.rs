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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub translation: String,
    pub book: u32,
    pub book_name: String,
    pub chapter: u32,
    pub verse: u32,
    pub text: String,
}

/// Opens the bundled Bible DB read-only.
pub fn open_bible(path: &Path) -> Result<Connection> {
    Ok(Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?)
}

/// Opens (creating and migrating if needed) the user DB.
pub fn open_user(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    migrate_user(&conn)?;
    Ok(conn)
}

// Verse references are translation-independent (book, chapter, verse) so a
// highlight or note follows the reader across translations.
const USER_MIGRATIONS: &[&str] = &["
    CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY,
        book INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (book, chapter, verse)
    );
    CREATE TABLE highlights (
        id INTEGER PRIMARY KEY,
        book INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        color TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (book, chapter, verse)
    );
    CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        book INTEGER NOT NULL,
        chapter INTEGER NOT NULL,
        verse INTEGER NOT NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX notes_ref ON notes (book, chapter, verse);
"];

fn migrate_user(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    for (i, sql) in USER_MIGRATIONS.iter().enumerate().skip(version as usize) {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i as i64 + 1)?;
        tx.commit()?;
    }
    Ok(())
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

pub fn get_chapter(
    conn: &Connection,
    translation: &str,
    book: u32,
    chapter: u32,
) -> Result<Vec<Verse>> {
    let mut stmt = conn.prepare_cached(
        "SELECT verse, verse_end, text FROM verses
         WHERE translation = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse",
    )?;
    let rows = stmt.query_map(params![translation, book, chapter], |r| {
        Ok(Verse { verse: r.get(0)?, verse_end: r.get(1)?, text: r.get(2)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Turns free text into a safe FTS5 query: every word is quoted (so FTS syntax
/// characters typed by the user are inert) and the last word matches as a prefix.
/// Returns `None` if the input has no searchable words.
fn fts_query(input: &str) -> Option<String> {
    let words: Vec<&str> = input
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let (last, rest) = words.split_last()?;
    let mut q: Vec<String> = rest.iter().map(|w| format!("\"{w}\"")).collect();
    q.push(format!("\"{last}\"*"));
    Some(q.join(" "))
}

/// Full-text search, best matches first. `translation = None` searches all translations.
pub fn search(
    conn: &Connection,
    query: &str,
    translation: Option<&str>,
    limit: u32,
) -> Result<Vec<SearchHit>> {
    let Some(q) = fts_query(query) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare_cached(
        "SELECT v.translation, v.book, b.name, v.chapter, v.verse, v.text
         FROM verses_fts
         JOIN verses v ON v.id = verses_fts.rowid
         JOIN books b ON b.id = v.book
         WHERE verses_fts MATCH ?1 AND (?2 IS NULL OR v.translation = ?2)
         ORDER BY verses_fts.rank
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(params![q, translation, limit], |r| {
        Ok(SearchHit {
            translation: r.get(0)?,
            book: r.get(1)?,
            book_name: r.get(2)?,
            chapter: r.get(3)?,
            verse: r.get(4)?,
            text: r.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
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
        assert_eq!(ids, ["KJV", "WEB"]);
    }

    #[test]
    fn returns_a_whole_chapter_in_order() {
        let conn = bible();
        let john3 = get_chapter(&conn, "KJV", 43, 3).unwrap();
        assert_eq!(john3.len(), 36);
        assert_eq!(john3[15].verse, 16);
        assert!(john3[15].text.starts_with("For God so loved the world"));
        assert!(john3.windows(2).all(|w| w[0].verse < w[1].verse));
        let psalm119 = get_chapter(&conn, "WEB", 19, 119).unwrap();
        assert_eq!(psalm119.len(), 176);
        assert!(get_chapter(&conn, "KJV", 43, 99).unwrap().is_empty());
        assert!(get_chapter(&conn, "NOPE", 43, 3).unwrap().is_empty());
    }

    #[test]
    fn translations_differ_where_manuscripts_differ() {
        let conn = bible();
        // Acts 8:37 is present in the KJV and omitted from the WEB.
        let has = |tr, verse| {
            get_chapter(&conn, tr, 44, 8).unwrap().iter().any(|v| v.verse == verse)
        };
        assert!(has("KJV", 37));
        assert!(!has("WEB", 37));
    }

    #[test]
    fn search_finds_verses_and_respects_translation_filter() {
        let conn = bible();
        let hits = search(&conn, "The LORD is my shepherd", Some("KJV"), 10).unwrap();
        assert_eq!((hits[0].book_name.as_str(), hits[0].chapter, hits[0].verse), ("Psalms", 23, 1));
        assert!(hits.iter().all(|h| h.translation == "KJV"));

        let all = search(&conn, "shepherd", None, 500).unwrap();
        assert!(all.iter().any(|h| h.translation == "KJV"));
        assert!(all.iter().any(|h| h.translation == "WEB"));

        // Stemming and prefix matching: "loving kind" finds "lovingkindness".
        assert!(!search(&conn, "loving kind", Some("KJV"), 5).unwrap().is_empty());
        assert_eq!(search(&conn, "shepherd", None, 3).unwrap().len(), 3);
    }

    #[test]
    fn search_never_errors_on_odd_input() {
        let conn = bible();
        for q in ["", "   ", "\"", "AND OR NOT", "NEAR(", "a -b", "col:on", "*", "'; DROP TABLE verses;--"] {
            search(&conn, q, None, 5).unwrap_or_else(|e| panic!("query {q:?} failed: {e}"));
        }
    }

    #[test]
    fn user_db_migrates_once() {
        let dir = std::env::temp_dir().join(format!("bible-app-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("user.db");
        {
            let conn = open_user(&path).unwrap();
            conn.execute("INSERT INTO highlights (book, chapter, verse, color) VALUES (43, 3, 16, 'yellow')", [])
                .unwrap();
        }
        // Re-opening must not re-run migrations or lose data.
        let conn = open_user(&path).unwrap();
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM highlights", [], |r| r.get(0)).unwrap();
        assert_eq!((version, n), (1, 1));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
