//! Cross-references: other passages related to a verse, best first. The data is OpenBible.info's (CC BY), built
//! mostly from the public-domain Treasury of Scripture Knowledge; see `scripts/build-bible-db.mjs`.

use crate::db::Result;
use rusqlite::{params, Connection};
use serde::Serialize;

/// A related passage: one verse, or a range that may run into a later chapter.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossRef {
    pub book: u32,
    pub chapter: u32,
    pub verse: u32,
    /// The last verse of the range; the same as `verse` and `chapter` for a single verse.
    pub end_chapter: u32,
    pub end_verse: u32,
    /// How many readers found it useful; the list is in this order.
    pub votes: i32,
    /// The passage's text, cut to its first few verses if it is a long range.
    pub text: String,
}

/// A verse as one number, matching `verseKey` in the build script.
fn split(key: i64) -> (u32, u32, u32) {
    (
        (key / 1_000_000) as u32,
        (key / 1_000 % 1_000) as u32,
        (key % 1_000) as u32,
    )
}

/// A range longer than this many verses shows only its first ones as text; the label still names all of it.
const TEXT_VERSES: u32 = 3;

/// The passages related to a verse, most useful first, with their text.
pub fn get_cross_refs(
    conn: &Connection,
    translation: &str,
    book: u32,
    chapter: u32,
    verse: u32,
) -> Result<Vec<CrossRef>> {
    let src = i64::from(book) * 1_000_000 + i64::from(chapter) * 1_000 + i64::from(verse);
    let mut refs = conn.prepare_cached(
        "SELECT dst, dst_end, votes FROM cross_refs WHERE src = ?1 ORDER BY votes DESC, dst, dst_end",
    )?;
    // (chapter, verse) is compared as a pair so the index on (book, chapter, verse) narrows the search.
    let mut text = conn.prepare_cached(
        "SELECT text FROM verses
         WHERE translation = ?1 AND book = ?2 AND (chapter, verse) >= (?3, ?4) AND (chapter, verse) <= (?5, ?6)
         ORDER BY chapter, verse LIMIT ?7",
    )?;
    let rows = refs
        .query_map(params![src], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i32>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut out = Vec::with_capacity(rows.len());
    for (dst, dst_end, votes) in rows {
        let (b, c, v) = split(dst);
        let (_, ec, ev) = split(dst_end);
        let text = text
            .query_map(params![translation, b, c, v, ec, ev, TEXT_VERSES], |r| {
                r.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .join(" ");
        out.push(CrossRef {
            book: b,
            chapter: c,
            verse: v,
            end_chapter: ec,
            end_verse: ev,
            votes,
            text,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_bible;

    fn bible() -> Connection {
        open_bible(std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/resources/bible.db"
        )))
        .unwrap()
    }

    fn refs(book: u32, chapter: u32, verse: u32) -> Vec<CrossRef> {
        get_cross_refs(&bible(), "KJV", book, chapter, verse).unwrap()
    }

    fn has(list: &[CrossRef], book: u32, chapter: u32, verse: u32) -> bool {
        list.iter()
            .any(|r| (r.book, r.chapter, r.verse) == (book, chapter, verse))
    }

    #[test]
    fn splits_a_verse_number_back_into_book_chapter_and_verse() {
        assert_eq!(split(43_003_016), (43, 3, 16));
        assert_eq!(split(19_119_176), (19, 119, 176));
        assert_eq!(split(1_001_001), (1, 1, 1));
    }

    #[test]
    fn john_3_16_points_to_its_well_known_neighbours_best_first() {
        let list = refs(43, 3, 16);
        assert!(list.len() >= 5, "{} refs", list.len());
        assert!(has(&list, 43, 3, 36), "John 3:36");
        assert!(has(&list, 45, 5, 8) || has(&list, 45, 5, 10), "Romans 5");
        assert!(
            list.windows(2).all(|w| w[0].votes >= w[1].votes),
            "most useful first"
        );
        assert!(
            list.iter().all(|r| !r.text.is_empty()),
            "every reference has text"
        );
    }

    #[test]
    fn a_reference_can_be_a_range() {
        // Genesis 1:1 is echoed by Romans 1:19-20.
        let list = refs(1, 1, 1);
        let r = list
            .iter()
            .find(|r| (r.book, r.chapter, r.verse) == (45, 1, 19))
            .expect("Romans 1:19-20");
        assert_eq!((r.end_chapter, r.end_verse), (1, 20));
        assert!(r.text.contains("invisible things"), "{}", r.text);
    }

    #[test]
    fn a_range_can_run_into_the_next_chapter() {
        let list = refs(1, 11, 31);
        let r = list
            .iter()
            .find(|r| (r.book, r.chapter, r.verse) == (1, 11, 32))
            .expect("Genesis 11:32-12:1");
        assert_eq!((r.end_chapter, r.end_verse), (12, 1));
        assert!(
            r.text.contains("Terah") && r.text.contains("Get thee out"),
            "{}",
            r.text
        );
    }

    #[test]
    fn long_ranges_show_only_their_first_verses() {
        let conn = bible();
        let long = conn
            .query_row(
                "SELECT src, dst, dst_end FROM cross_refs WHERE dst_end - dst BETWEEN 8 AND 20 AND dst_end / 1000 = dst / 1000 LIMIT 1",
                [],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
            )
            .unwrap();
        let (b, c, v) = split(long.0);
        let list = get_cross_refs(&conn, "KJV", b, c, v).unwrap();
        let r = list
            .iter()
            .find(|r| {
                i64::from(r.book) * 1_000_000 + i64::from(r.chapter) * 1_000 + i64::from(r.verse)
                    == long.1
            })
            .unwrap();
        assert!(r.end_verse - r.verse >= 8);
        let (_, _, last) = split(long.2);
        let last_text =
            crate::db::verse_text(&conn, "KJV", r.book, r.end_chapter, last, None).unwrap();
        assert!(
            !r.text.contains(&last_text),
            "the last verse of a long range is not in the preview"
        );
        let first_text =
            crate::db::verse_text(&conn, "KJV", r.book, r.chapter, r.verse, None).unwrap();
        assert!(
            r.text.starts_with(&first_text),
            "the preview starts with the range's first verse"
        );
    }

    #[test]
    fn nearly_every_verse_has_some_and_a_missing_one_has_none() {
        let conn = bible();
        let with: u32 = conn
            .query_row("SELECT COUNT(DISTINCT src) FROM cross_refs", [], |r| {
                r.get(0)
            })
            .unwrap();
        let all: u32 = conn
            .query_row("SELECT COUNT(*) FROM verses", [], |r| r.get(0))
            .unwrap();
        assert!(f64::from(with) / f64::from(all) > 0.9, "{with} of {all}");
        assert!(refs(43, 3, 999).is_empty());
        assert!(refs(0, 0, 0).is_empty());
    }

    #[test]
    fn a_verse_does_not_refer_to_itself() {
        let conn = bible();
        let n: u32 = conn
            .query_row(
                "SELECT COUNT(*) FROM cross_refs WHERE src = dst AND src = dst_end",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn looking_them_up_is_fast() {
        let conn = bible();
        let started = std::time::Instant::now();
        let list = get_cross_refs(&conn, "KJV", 44, 24, 25).unwrap(); // the verse with the most
        assert!(list.len() > 20);
        let limit = if cfg!(debug_assertions) { 400 } else { 100 };
        assert!(
            started.elapsed().as_millis() < limit,
            "took {:?}",
            started.elapsed()
        );
    }
}
