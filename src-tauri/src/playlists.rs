//! Saved presentation-mode playlists: an ordered, reusable list of passages a presenter builds ahead of a church
//! service and steps through live. Verses are referenced as (book, chapter, verse), like every other mark;
//! slide decks by their id in the `decks` table (their images live on disk, see decks.rs).

use crate::db::{Error, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// One entry in a playlist: a passage, or a deck of slide images (see decks.rs).
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PlaylistItem {
    Passage {
        id: i64,
        book: u32,
        chapter: u32,
        verse: u32,
        verse_end: Option<u32>,
        /// An optional label for the item (e.g. "Call to worship"), shown instead of the reference.
        label: Option<String>,
    },
    Deck { id: i64, deck: i64, name: String, slide_count: u32, label: Option<String> },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub updated_at: String,
    pub items: Vec<PlaylistItem>,
}

/// An item as sent from the UI when saving a playlist's items, in the order it should be stored.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum NewItem {
    Passage { book: u32, chapter: u32, verse: u32, verse_end: Option<u32>, label: Option<String> },
    Deck { deck: i64, label: Option<String> },
}

fn item_from_row(r: &rusqlite::Row) -> rusqlite::Result<Option<PlaylistItem>> {
    let id = r.get(0)?;
    let label = r.get(5)?;
    Ok(match r.get::<_, Option<i64>>(6)? {
        None => Some(PlaylistItem::Passage { id, book: r.get(1)?, chapter: r.get(2)?, verse: r.get(3)?, verse_end: r.get(4)?, label }),
        // A deck item whose deck is gone (it shouldn't be) is skipped rather than failing the whole list.
        Some(deck) => match (r.get::<_, Option<String>>(7)?, r.get::<_, Option<u32>>(8)?) {
            (Some(name), Some(slide_count)) => Some(PlaylistItem::Deck { id, deck, name, slide_count, label }),
            _ => None,
        },
    })
}

/// A name to store: falls back to "Untitled playlist" rather than leaving a playlist unnamed.
fn cleaned_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() { "Untitled playlist".to_string() } else { trimmed.to_string() }
}

/// Every saved playlist, most recently updated first, with its items in order.
pub fn list_playlists(conn: &Connection) -> Result<Vec<Playlist>> {
    let mut playlists: Vec<Playlist> = conn
        .prepare_cached("SELECT id, name, updated_at FROM playlists ORDER BY updated_at DESC, id DESC")?
        .query_map([], |r| Ok(Playlist { id: r.get(0)?, name: r.get(1)?, updated_at: r.get(2)?, items: Vec::new() }))?
        .collect::<rusqlite::Result<_>>()?;
    let mut items_stmt = conn.prepare_cached(
        "SELECT i.id, i.book, i.chapter, i.verse, i.verse_end, i.label, i.deck, d.name, d.slide_count
         FROM playlist_items i LEFT JOIN decks d ON d.id = i.deck
         WHERE i.playlist = ?1 ORDER BY i.position",
    )?;
    for s in &mut playlists {
        s.items = items_stmt
            .query_map(params![s.id], item_from_row)?
            .filter_map(|r| r.transpose())
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(playlists)
}

/// Creates an empty playlist and returns its id.
pub fn create_playlist(conn: &Connection, name: &str) -> Result<i64> {
    conn.execute("INSERT INTO playlists (name) VALUES (?1)", params![cleaned_name(name)])?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_playlist(conn: &Connection, id: i64, name: &str) -> Result<()> {
    conn.execute(
        "UPDATE playlists SET name = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![id, cleaned_name(name)],
    )?;
    Ok(())
}

/// Deletes a playlist and its items. Returns the decks no playlist uses any more, now deleted from
/// the DB, whose image files the caller should remove.
pub fn delete_playlist(conn: &Connection, id: i64) -> Result<Vec<i64>> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM playlist_items WHERE playlist = ?1", params![id])?;
    tx.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    let unused = remove_unused_decks(&tx)?;
    tx.commit()?;
    Ok(unused)
}

/// Replaces a playlist's items with `items`, in the given order, and touches its `updated_at`.
/// Returns the decks no playlist uses any more, like `delete_playlist`.
pub fn save_playlist_items(conn: &Connection, id: i64, items: &[NewItem]) -> Result<Vec<i64>> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM playlist_items WHERE playlist = ?1", params![id])?;
    for (position, item) in items.iter().enumerate() {
        match item {
            NewItem::Passage { book, chapter, verse, verse_end, label } => tx.execute(
                "INSERT INTO playlist_items (playlist, position, book, chapter, verse, verse_end, label)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![id, position as i64, book, chapter, verse, verse_end, label],
            )?,
            NewItem::Deck { deck, label } => tx.execute(
                "INSERT INTO playlist_items (playlist, position, deck, label) VALUES (?1, ?2, ?3, ?4)",
                params![id, position as i64, deck, label],
            )?,
        };
    }
    tx.execute("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1", params![id])?;
    let unused = remove_unused_decks(&tx)?;
    tx.commit()?;
    Ok(unused)
}

/// Appends a deck to the end of a playlist (used by an import, in the same transaction that created
/// the deck, so a freshly imported deck is never momentarily unused).
pub fn append_deck(conn: &Connection, playlist: i64, deck: i64) -> Result<()> {
    let exists: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM playlists WHERE id = ?1)", params![playlist], |r| r.get(0))?;
    if !exists {
        return Err(Error::Invalid("That playlist no longer exists.".into()));
    }
    conn.execute(
        "INSERT INTO playlist_items (playlist, position, deck)
         VALUES (?1, (SELECT COALESCE(MAX(position) + 1, 0) FROM playlist_items WHERE playlist = ?1), ?2)",
        params![playlist, deck],
    )?;
    conn.execute("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1", params![playlist])?;
    Ok(())
}

/// Deletes decks that no playlist item refers to any more, returning their ids.
fn remove_unused_decks(conn: &Connection) -> Result<Vec<i64>> {
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM decks WHERE id NOT IN (SELECT deck FROM playlist_items WHERE deck IS NOT NULL)")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for id in &ids {
        conn.execute("DELETE FROM decks WHERE id = ?1", params![id])?;
    }
    Ok(ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, migrated, in-memory user database.
    fn conn() -> Connection {
        crate::user::open(std::path::Path::new(":memory:")).unwrap()
    }

    fn passage(book: u32, chapter: u32, verse: u32) -> NewItem {
        NewItem::Passage { book, chapter, verse, verse_end: None, label: None }
    }

    fn new_deck(c: &Connection, name: &str, slides: u32) -> i64 {
        c.execute("INSERT INTO decks (name, slide_count) VALUES (?1, ?2)", params![name, slides]).unwrap();
        c.last_insert_rowid()
    }

    fn deck_ids(c: &Connection) -> Vec<i64> {
        c.prepare("SELECT id FROM decks ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect()
    }

    /// (book, verse) for passages, (-deck, 0) for decks: a compact way to compare item orders.
    fn shape(items: &[PlaylistItem]) -> Vec<(i64, u32)> {
        items
            .iter()
            .map(|i| match i {
                PlaylistItem::Passage { book, verse, .. } => (*book as i64, *verse),
                PlaylistItem::Deck { deck, .. } => (-deck, 0),
            })
            .collect()
    }

    #[test]
    fn creates_lists_and_deletes_playlists() {
        let c = conn();
        assert!(list_playlists(&c).unwrap().is_empty());
        let id = create_playlist(&c, "Sunday playlist").unwrap();
        let playlists = list_playlists(&c).unwrap();
        assert_eq!((playlists.len(), playlists[0].id, playlists[0].name.as_str()), (1, id, "Sunday playlist"));
        assert!(playlists[0].items.is_empty());

        delete_playlist(&c, id).unwrap();
        assert!(list_playlists(&c).unwrap().is_empty());
    }

    #[test]
    fn blank_names_fall_back_to_a_default() {
        let c = conn();
        let id = create_playlist(&c, "   ").unwrap();
        assert_eq!(list_playlists(&c).unwrap()[0].name, "Untitled playlist");
        rename_playlist(&c, id, "").unwrap();
        assert_eq!(list_playlists(&c).unwrap()[0].name, "Untitled playlist");
    }

    #[test]
    fn renaming_updates_the_name_only() {
        let c = conn();
        let id = create_playlist(&c, "Draft").unwrap();
        rename_playlist(&c, id, "Sunday, 9am").unwrap();
        let playlists = list_playlists(&c).unwrap();
        assert_eq!((playlists.len(), playlists[0].name.as_str()), (1, "Sunday, 9am"));
    }

    #[test]
    fn saving_items_stores_them_in_order() {
        let c = conn();
        let id = create_playlist(&c, "Playlist").unwrap();
        save_playlist_items(
            &c,
            id,
            &[
                NewItem::Passage { book: 19, chapter: 100, verse: 1, verse_end: None, label: Some("Call to worship".into()) },
                passage(43, 3, 16),
                NewItem::Passage { book: 45, chapter: 8, verse: 1, verse_end: Some(2), label: None },
            ],
        )
        .unwrap();

        let items = &list_playlists(&c).unwrap()[0].items;
        assert_eq!(items.len(), 3);
        assert!(matches!(&items[0], PlaylistItem::Passage { book: 19, chapter: 100, verse: 1, label: Some(l), .. } if l == "Call to worship"));
        assert!(matches!(&items[1], PlaylistItem::Passage { book: 43, chapter: 3, verse: 16, .. }));
        assert!(matches!(&items[2], PlaylistItem::Passage { book: 45, verse_end: Some(2), .. }));
    }

    #[test]
    fn saving_items_again_replaces_the_previous_set() {
        let c = conn();
        let id = create_playlist(&c, "Playlist").unwrap();
        save_playlist_items(&c, id, &[passage(43, 3, 16)]).unwrap();
        save_playlist_items(&c, id, &[passage(19, 23, 1), passage(19, 100, 5)]).unwrap();

        assert_eq!(shape(&list_playlists(&c).unwrap()[0].items), [(19, 1), (19, 5)]);
    }

    #[test]
    fn deleting_a_playlist_removes_its_items_and_leaves_others() {
        let c = conn();
        let a = create_playlist(&c, "A").unwrap();
        let b = create_playlist(&c, "B").unwrap();
        save_playlist_items(&c, a, &[passage(43, 3, 16)]).unwrap();
        save_playlist_items(&c, b, &[passage(19, 23, 1)]).unwrap();

        delete_playlist(&c, a).unwrap();
        let playlists = list_playlists(&c).unwrap();
        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].id, b);
        let orphans: i64 = c.query_row("SELECT COUNT(*) FROM playlist_items WHERE playlist = ?1", params![a], |r| r.get(0)).unwrap();
        assert_eq!(orphans, 0);
    }

    #[test]
    fn decks_mix_with_passages_and_list_their_name_and_size() {
        let c = conn();
        let id = create_playlist(&c, "Sunday").unwrap();
        let deck = new_deck(&c, "Welcome.pptx", 12);
        save_playlist_items(&c, id, &[passage(19, 100, 1), NewItem::Deck { deck, label: None }, passage(43, 3, 16)]).unwrap();

        let items = &list_playlists(&c).unwrap()[0].items;
        assert_eq!(shape(items), [(19, 1), (-deck, 0), (43, 16)]);
        assert!(matches!(&items[1], PlaylistItem::Deck { name, slide_count: 12, .. } if name == "Welcome.pptx"));
    }

    #[test]
    fn appending_a_deck_puts_it_last() {
        let c = conn();
        let id = create_playlist(&c, "Sunday").unwrap();
        save_playlist_items(&c, id, &[passage(43, 3, 16)]).unwrap();
        let deck = new_deck(&c, "Songs", 3);
        append_deck(&c, id, deck).unwrap();
        assert_eq!(shape(&list_playlists(&c).unwrap()[0].items), [(43, 16), (-deck, 0)]);

        // Into an empty playlist, and a missing playlist is refused rather than leaving a stray item.
        let empty = create_playlist(&c, "Empty").unwrap();
        append_deck(&c, empty, deck).unwrap();
        assert!(append_deck(&c, 999, deck).is_err());
    }

    #[test]
    fn decks_are_removed_once_no_playlist_uses_them() {
        let c = conn();
        let a = create_playlist(&c, "A").unwrap();
        let b = create_playlist(&c, "B").unwrap();
        let shared = new_deck(&c, "Shared", 2);
        let only_a = new_deck(&c, "Only A", 1);
        save_playlist_items(&c, a, &[NewItem::Deck { deck: shared, label: None }, NewItem::Deck { deck: only_a, label: None }]).unwrap();
        save_playlist_items(&c, b, &[NewItem::Deck { deck: shared, label: None }]).unwrap();

        // Removing "Only A" from A frees it; "Shared" is still used by both.
        assert_eq!(save_playlist_items(&c, a, &[NewItem::Deck { deck: shared, label: None }]).unwrap(), [only_a]);
        assert_eq!(deck_ids(&c), [shared]);
        // Deleting A leaves "Shared" for B; deleting B too frees it.
        assert!(delete_playlist(&c, a).unwrap().is_empty());
        assert_eq!(delete_playlist(&c, b).unwrap(), [shared]);
        assert!(deck_ids(&c).is_empty());
    }

    #[test]
    fn items_serialize_with_a_kind_tag_and_camel_case_fields() {
        let passage = PlaylistItem::Passage { id: 1, book: 43, chapter: 3, verse: 16, verse_end: Some(17), label: None };
        let deck = PlaylistItem::Deck { id: 2, deck: 5, name: "Songs".into(), slide_count: 3, label: None };
        assert_eq!(
            serde_json::to_value(&passage).unwrap(),
            serde_json::json!({"kind": "passage", "id": 1, "book": 43, "chapter": 3, "verse": 16, "verseEnd": 17, "label": null})
        );
        assert_eq!(
            serde_json::to_value(&deck).unwrap(),
            serde_json::json!({"kind": "deck", "id": 2, "deck": 5, "name": "Songs", "slideCount": 3, "label": null})
        );
        let parsed: NewItem = serde_json::from_value(serde_json::json!({"kind": "passage", "book": 43, "chapter": 3, "verse": 16, "verseEnd": null, "label": null})).unwrap();
        assert!(matches!(parsed, NewItem::Passage { book: 43, verse: 16, .. }));
        let parsed: NewItem = serde_json::from_value(serde_json::json!({"kind": "deck", "deck": 5, "label": null})).unwrap();
        assert!(matches!(parsed, NewItem::Deck { deck: 5, .. }));
    }
}
