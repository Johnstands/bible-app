//! Strong's numbers: the Hebrew or Greek word behind a phrase of the KJV, its dictionary entry, and every verse
//! that uses it. The tags come from the KJV source and the dictionary from James Strong's 1890 and 1894 works
//! (JSON edition by Open Scriptures, CC BY-SA); see `scripts/build-bible-db.mjs`.

use crate::db::{Result, SearchFilter, SearchHit, SearchResults, MATCH_END, MATCH_START};
use rusqlite::{params, Connection};
use serde::Serialize;

/// A phrase of a verse that has a Strong's number. `start` and `end` index the verse's text in UTF-16 units,
/// which is what JavaScript slices by (the KJV has no characters outside the basic plane, so they are also
/// character positions).
#[derive(Debug, Serialize)]
pub struct WordTag {
    pub start: u32,
    pub end: u32,
    pub num: String,
}

#[derive(Debug, Serialize)]
pub struct VerseTags {
    pub verse: u32,
    pub tags: Vec<WordTag>,
}

/// One way the KJV renders a Hebrew or Greek word, and how often.
#[derive(Debug, Serialize)]
pub struct Rendering {
    pub word: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrongsEntry {
    pub num: String,
    /// The word in Hebrew or Greek letters.
    pub lemma: String,
    pub translit: String,
    /// How to say it (Hebrew entries only).
    pub pron: Option<String>,
    /// Strong's entry: where the word comes from, then what it means.
    pub def: String,
    /// Strong's own list of the KJV renderings.
    pub kjv: Option<String>,
    /// How many phrases of the KJV carry this number.
    pub uses: u32,
    /// The most common KJV renderings, counted from the text itself.
    pub renderings: Vec<Rendering>,
}

/// `H7225`, `g 26` and `h0430` are Strong's numbers; anything else is not. Returns the normalized form.
pub fn parse_number(query: &str) -> Option<String> {
    let mut chars = query.trim().chars();
    let letter = chars.next()?.to_ascii_uppercase();
    if letter != 'H' && letter != 'G' {
        return None;
    }
    let digits: String = chars.as_str().trim().to_string();
    if digits.is_empty() || digits.len() > 5 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: u32 = digits.parse().ok()?;
    (n > 0).then(|| format!("{letter}{n}"))
}

/// The phrases with Strong's numbers in one chapter, by verse.
pub fn get_word_tags(
    conn: &Connection,
    translation: &str,
    book: u32,
    chapter: u32,
) -> Result<Vec<VerseTags>> {
    let mut stmt = conn.prepare_cached(
        "SELECT v.verse, t.start_at, t.end_at, t.num
         FROM verses v JOIN word_tags t ON t.verse_id = v.id
         WHERE v.translation = ?1 AND v.book = ?2 AND v.chapter = ?3
         ORDER BY v.verse, t.start_at",
    )?;
    let rows = stmt.query_map(params![translation, book, chapter], |r| {
        Ok((
            r.get::<_, u32>(0)?,
            WordTag {
                start: r.get(1)?,
                end: r.get(2)?,
                num: r.get(3)?,
            },
        ))
    })?;
    let mut out: Vec<VerseTags> = Vec::new();
    for row in rows {
        let (verse, tag) = row?;
        match out.last_mut() {
            Some(last) if last.verse == verse => last.tags.push(tag),
            _ => out.push(VerseTags {
                verse,
                tags: vec![tag],
            }),
        }
    }
    Ok(out)
}

const TOP_RENDERINGS: u32 = 8;

/// The dictionary entry for a number such as `H7225`, with how the KJV renders it. `None` for an unknown number.
pub fn get_strongs(conn: &Connection, num: &str) -> Result<Option<StrongsEntry>> {
    let Some(num) = parse_number(num) else {
        return Ok(None);
    };
    let entry = conn
        .prepare_cached("SELECT lemma, translit, pron, def, kjv FROM strongs WHERE num = ?1")?
        .query_row(params![num], |r| {
            Ok(StrongsEntry {
                num: num.clone(),
                lemma: r.get(0)?,
                translit: r.get(1)?,
                pron: r.get(2)?,
                def: r.get(3)?,
                kjv: r.get(4)?,
                uses: 0,
                renderings: Vec::new(),
            })
        });
    let mut entry = match entry {
        Ok(e) => e,
        Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    entry.uses = conn
        .prepare_cached("SELECT COUNT(*) FROM word_tags WHERE num = ?1")?
        .query_row(params![num], |r| r.get(0))?;
    let mut stmt = conn.prepare_cached(
        "SELECT lower(substr(v.text, t.start_at + 1, t.end_at - t.start_at)) AS word, COUNT(*) AS n
         FROM word_tags t JOIN verses v ON v.id = t.verse_id
         WHERE t.num = ?1
         GROUP BY word ORDER BY n DESC, word LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![num, TOP_RENDERINGS], |r| {
        Ok(Rendering {
            word: r.get(0)?,
            count: r.get(1)?,
        })
    })?;
    entry.renderings = rows.collect::<rusqlite::Result<_>>()?;
    Ok(Some(entry))
}

/// Longest verse shown whole in a result; longer ones are cut down around the first use.
const SNIPPET_CHARS: usize = 200;

/// The verse with each tagged phrase between the match markers, shortened around the first one if long.
fn snippet(text: &str, spans: &[(usize, usize)]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut spans: Vec<(usize, usize)> = spans
        .iter()
        .copied()
        .filter(|&(a, b)| a < b && b <= chars.len())
        .collect();
    spans.sort_unstable();
    let (mut from, mut to) = (0, chars.len());
    if chars.len() > SNIPPET_CHARS {
        let first = spans.first().map_or(0, |s| s.0);
        from = first.saturating_sub(SNIPPET_CHARS / 3);
        to = (from + SNIPPET_CHARS).min(chars.len());
        // Start and stop at word boundaries.
        while from > 0 && chars[from - 1] != ' ' {
            from -= 1;
        }
        while to < chars.len() && chars[to] != ' ' {
            to += 1;
        }
    }
    let mut out = String::new();
    if from > 0 {
        out.push('…');
    }
    let mut spans = spans.into_iter().peekable();
    for (i, &c) in chars.iter().enumerate().take(to).skip(from) {
        while spans.peek().is_some_and(|s| s.1 <= i) {
            spans.next();
        }
        if spans.peek().is_some_and(|s| s.0 == i) {
            out.push(MATCH_START);
        }
        out.push(c);
        if spans.peek().is_some_and(|s| s.1 == i + 1) {
            out.push(MATCH_END);
        }
    }
    if to < chars.len() {
        out.push('…');
    }
    out
}

/// Every verse that uses `num`, in Bible order, with the word marked, honoring the same filters as a text search.
pub fn search_number(
    conn: &Connection,
    num: &str,
    filter: &SearchFilter,
    limit: u32,
    offset: u32,
) -> Result<SearchResults> {
    const FROM_WHERE: &str = "FROM word_tags t
         JOIN verses v ON v.id = t.verse_id
         JOIN books b ON b.id = v.book
         WHERE t.num = ?1
           AND (?2 IS NULL OR v.translation = ?2)
           AND (?3 IS NULL OR b.testament = ?3)
           AND (?4 IS NULL OR v.book = ?4)";
    let total = conn
        .prepare_cached(&format!("SELECT COUNT(DISTINCT v.id) {FROM_WHERE}"))?
        .query_row(
            params![num, filter.translation, filter.testament, filter.book],
            |r| r.get(0),
        )?;
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT v.translation, v.book, b.name, v.chapter, v.verse, v.text,
                group_concat(t.start_at || ',' || t.end_at, ';')
         {FROM_WHERE}
         GROUP BY v.id ORDER BY v.book, v.chapter, v.verse
         LIMIT ?5 OFFSET ?6"
    ))?;
    let rows = stmt.query_map(
        params![
            num,
            filter.translation,
            filter.testament,
            filter.book,
            limit,
            offset
        ],
        |r| {
            let text: String = r.get(5)?;
            let spans: Vec<(usize, usize)> = r
                .get::<_, String>(6)?
                .split(';')
                .filter_map(|p| {
                    let (a, b) = p.split_once(',')?;
                    Some((a.parse().ok()?, b.parse().ok()?))
                })
                .collect();
            Ok(SearchHit {
                translation: r.get(0)?,
                book: r.get(1)?,
                book_name: r.get(2)?,
                chapter: r.get(3)?,
                verse: r.get(4)?,
                snippet: snippet(&text, &spans),
            })
        },
    )?;
    Ok(SearchResults {
        total,
        hits: rows.collect::<rusqlite::Result<_>>()?,
    })
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

    fn marked(snippet: &str) -> Vec<String> {
        let mut found = Vec::new();
        let mut cur: Option<String> = None;
        for c in snippet.chars() {
            match c {
                MATCH_START => cur = Some(String::new()),
                MATCH_END => found.extend(cur.take()),
                c => {
                    if let Some(s) = cur.as_mut() {
                        s.push(c);
                    }
                }
            }
        }
        found
    }

    #[test]
    fn parses_strongs_numbers_in_any_case_and_padding() {
        assert_eq!(parse_number("H7225").as_deref(), Some("H7225"));
        assert_eq!(parse_number(" g26 ").as_deref(), Some("G26"));
        assert_eq!(parse_number("h0430").as_deref(), Some("H430"));
        assert_eq!(parse_number("G 25").as_deref(), Some("G25"));
    }

    #[test]
    fn other_queries_are_not_numbers() {
        for q in [
            "", "H", "love", "H0", "G26x", "X26", "hello", "H123456", "26",
        ] {
            assert_eq!(parse_number(q), None, "{q:?}");
        }
    }

    #[test]
    fn tags_land_on_the_words_of_a_verse() {
        let conn = bible();
        let text = crate::db::verse_text(&conn, "KJV", 43, 3, 16, None).unwrap();
        let tags = get_word_tags(&conn, "KJV", 43, 3).unwrap();
        let verse = tags
            .iter()
            .find(|v| v.verse == 16)
            .expect("John 3:16 is tagged");
        let chars: Vec<char> = text.chars().collect();
        let pairs: Vec<(String, &str)> = verse
            .tags
            .iter()
            .map(|t| {
                (
                    chars[t.start as usize..t.end as usize].iter().collect(),
                    t.num.as_str(),
                )
            })
            .collect();
        assert!(pairs.contains(&("loved".to_string(), "G25")), "{pairs:?}");
        assert!(
            pairs.contains(&("only begotten".to_string(), "G3439")),
            "{pairs:?}"
        );
        assert!(
            verse.tags.windows(2).all(|w| w[0].end <= w[1].start),
            "tags are in order and do not overlap"
        );
    }

    #[test]
    fn a_chapter_lists_its_tagged_verses_in_order() {
        let tags = get_word_tags(&bible(), "KJV", 19, 23).unwrap();
        assert!(tags.len() >= 5, "Psalm 23 has most verses tagged");
        assert!(tags.windows(2).all(|w| w[0].verse < w[1].verse));
    }

    #[test]
    fn looks_up_a_dictionary_entry_with_its_renderings() {
        let e = get_strongs(&bible(), "H7225")
            .unwrap()
            .expect("H7225 exists");
        // The vowel marks can be stored in more than one order, so check the letters and the transliteration.
        assert!(
            e.lemma.starts_with('ר') && e.lemma.ends_with('ת'),
            "{}",
            e.lemma
        );
        assert!(e.translit.ends_with("shîyth"), "{}", e.translit);
        assert!(e.def.contains("the first"), "{}", e.def);
        assert!(e.uses > 30);
        assert_eq!(e.renderings[0].word, "beginning");
        assert!(e.renderings.windows(2).all(|w| w[0].count >= w[1].count));

        let g = get_strongs(&bible(), "g26").unwrap().expect("G26 exists");
        assert_eq!(g.translit, "agápē");
        assert!(g.renderings.iter().any(|r| r.word == "love"));
    }

    #[test]
    fn unknown_numbers_have_no_entry() {
        assert!(get_strongs(&bible(), "G99999").unwrap().is_none());
        assert!(get_strongs(&bible(), "love").unwrap().is_none());
    }

    #[test]
    fn a_number_search_lists_verses_in_bible_order_with_the_word_marked() {
        let conn = bible();
        let all = SearchFilter::default();
        let r = search_number(&conn, "G26", &all, 500, 0).unwrap();
        assert!(r.total >= 100, "agape is common: {}", r.total);
        assert_eq!(r.hits.len() as u32, r.total);
        let order: Vec<_> = r
            .hits
            .iter()
            .map(|h| (h.book, h.chapter, h.verse))
            .collect();
        assert!(
            order.windows(2).all(|w| w[0] < w[1]),
            "canonical order, one hit per verse"
        );
        assert!(r.hits.iter().all(|h| !marked(&h.snippet).is_empty()));
        let rom = r
            .hits
            .iter()
            .find(|h| (h.book, h.chapter, h.verse) == (45, 5, 8))
            .expect("Romans 5:8");
        assert_eq!(marked(&rom.snippet), vec!["love"]);
    }

    #[test]
    fn a_number_search_honors_filters_and_paging() {
        let conn = bible();
        let ot = SearchFilter {
            testament: Some("OT"),
            ..Default::default()
        };
        assert_eq!(
            search_number(&conn, "G26", &ot, 50, 0).unwrap().total,
            0,
            "a Greek word is not in the OT"
        );
        let nt = SearchFilter {
            testament: Some("NT"),
            ..Default::default()
        };
        let page1 = search_number(&conn, "G26", &nt, 10, 0).unwrap();
        let page2 = search_number(&conn, "G26", &nt, 10, 10).unwrap();
        assert_eq!((page1.hits.len(), page2.hits.len()), (10, 10));
        assert_eq!(page1.total, page2.total);
        assert_ne!(page1.hits[0].verse, page2.hits[0].verse);
    }

    #[test]
    fn long_verses_are_cut_down_around_the_word() {
        let text = format!("{} target {}", "a ".repeat(200), "b ".repeat(200));
        let start = text.find("target").unwrap();
        let s = snippet(&text, &[(start, start + 6)]);
        assert!(s.starts_with('…') && s.ends_with('…'));
        assert!(s.chars().count() < text.chars().count() / 2);
        assert_eq!(marked(&s), vec!["target"]);
    }

    #[test]
    fn a_number_search_is_fast() {
        let conn = bible();
        let started = std::time::Instant::now();
        search_number(&conn, "H430", &SearchFilter::default(), 50, 0).unwrap();
        get_strongs(&conn, "H430").unwrap();
        let limit = if cfg!(debug_assertions) { 400 } else { 100 };
        assert!(
            started.elapsed().as_millis() < limit,
            "took {:?}",
            started.elapsed()
        );
    }
}
