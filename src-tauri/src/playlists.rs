//! Saved presentation-mode playlists: an ordered, reusable list of passages a presenter builds ahead of a church
//! service and steps through live. Verses are referenced as (book, chapter, verse), like every other mark.

use crate::db::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: i64,
    pub book: u32,
    pub chapter: u32,
    pub verse: u32,
    pub verse_end: Option<u32>,
    /// An optional label for the item (e.g. "Call to worship"), shown instead of the reference.
    pub label: Option<String>,
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
#[serde(rename_all = "camelCase")]
pub struct NewItem {
    pub book: u32,
    pub chapter: u32,
    pub verse: u32,
    pub verse_end: Option<u32>,
    pub label: Option<String>,
}

fn item_from_row(r: &rusqlite::Row) -> rusqlite::Result<PlaylistItem> {
    Ok(PlaylistItem { id: r.get(0)?, book: r.get(1)?, chapter: r.get(2)?, verse: r.get(3)?, verse_end: r.get(4)?, label: r.get(5)? })
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
        "SELECT id, book, chapter, verse, verse_end, label FROM playlist_items WHERE playlist = ?1 ORDER BY position",
    )?;
    for s in &mut playlists {
        s.items = items_stmt.query_map(params![s.id], item_from_row)?.collect::<rusqlite::Result<_>>()?;
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

/// Deletes a playlist and its items.
pub fn delete_playlist(conn: &Connection, id: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM playlist_items WHERE playlist = ?1", params![id])?;
    tx.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(())
}

/// Replaces a playlist's items with `items`, in the given order, and touches its `updated_at`.
pub fn save_playlist_items(conn: &Connection, id: i64, items: &[NewItem]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM playlist_items WHERE playlist = ?1", params![id])?;
    for (position, item) in items.iter().enumerate() {
        tx.execute(
            "INSERT INTO playlist_items (playlist, position, book, chapter, verse, verse_end, label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, position as i64, item.book, item.chapter, item.verse, item.verse_end, item.label],
        )?;
    }
    tx.execute("UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh, migrated, in-memory user database.
    fn conn() -> Connection {
        crate::user::open(std::path::Path::new(":memory:")).unwrap()
    }

    fn item(book: u32, chapter: u32, verse: u32) -> NewItem {
        NewItem { book, chapter, verse, verse_end: None, label: None }
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
                NewItem { label: Some("Call to worship".into()), ..item(19, 100, 1) },
                item(43, 3, 16),
                NewItem { verse_end: Some(2), ..item(45, 8, 1) },
            ],
        )
        .unwrap();

        let items = &list_playlists(&c).unwrap()[0].items;
        assert_eq!(items.len(), 3);
        assert_eq!((items[0].book, items[0].chapter, items[0].verse, items[0].label.as_deref()), (19, 100, 1, Some("Call to worship")));
        assert_eq!((items[1].book, items[1].chapter, items[1].verse), (43, 3, 16));
        assert_eq!((items[2].book, items[2].verse_end), (45, Some(2)));
    }

    #[test]
    fn saving_items_again_replaces_the_previous_set() {
        let c = conn();
        let id = create_playlist(&c, "Playlist").unwrap();
        save_playlist_items(&c, id, &[item(43, 3, 16)]).unwrap();
        save_playlist_items(&c, id, &[item(19, 23, 1), item(19, 100, 5)]).unwrap();

        let items = &list_playlists(&c).unwrap()[0].items;
        assert_eq!(items.iter().map(|i| (i.book, i.verse)).collect::<Vec<_>>(), [(19, 1), (19, 5)]);
    }

    #[test]
    fn deleting_a_playlist_removes_its_items_and_leaves_others() {
        let c = conn();
        let a = create_playlist(&c, "A").unwrap();
        let b = create_playlist(&c, "B").unwrap();
        save_playlist_items(&c, a, &[item(43, 3, 16)]).unwrap();
        save_playlist_items(&c, b, &[item(19, 23, 1)]).unwrap();

        delete_playlist(&c, a).unwrap();
        let playlists = list_playlists(&c).unwrap();
        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].id, b);
        let orphans: i64 = c.query_row("SELECT COUNT(*) FROM playlist_items WHERE playlist = ?1", params![a], |r| r.get(0)).unwrap();
        assert_eq!(orphans, 0);
    }
}
