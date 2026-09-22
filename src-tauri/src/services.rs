//! Saved presentation-mode "services": an ordered, reusable list of passages a presenter builds ahead of a church
//! service and steps through live. Verses are referenced as (book, chapter, verse), like every other mark.

use crate::db::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceItem {
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
pub struct Service {
    pub id: i64,
    pub name: String,
    pub updated_at: String,
    pub items: Vec<ServiceItem>,
}

/// An item as sent from the UI when saving a service's list, in the order it should be stored.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewItem {
    pub book: u32,
    pub chapter: u32,
    pub verse: u32,
    pub verse_end: Option<u32>,
    pub label: Option<String>,
}

fn item_from_row(r: &rusqlite::Row) -> rusqlite::Result<ServiceItem> {
    Ok(ServiceItem { id: r.get(0)?, book: r.get(1)?, chapter: r.get(2)?, verse: r.get(3)?, verse_end: r.get(4)?, label: r.get(5)? })
}

/// A name to store: falls back to "Untitled service" rather than leaving a service unnamed.
fn cleaned_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() { "Untitled service".to_string() } else { trimmed.to_string() }
}

/// Every saved service, most recently updated first, with its items in order.
pub fn list_services(conn: &Connection) -> Result<Vec<Service>> {
    let mut services: Vec<Service> = conn
        .prepare_cached("SELECT id, name, updated_at FROM services ORDER BY updated_at DESC, id DESC")?
        .query_map([], |r| Ok(Service { id: r.get(0)?, name: r.get(1)?, updated_at: r.get(2)?, items: Vec::new() }))?
        .collect::<rusqlite::Result<_>>()?;
    let mut items_stmt = conn.prepare_cached(
        "SELECT id, book, chapter, verse, verse_end, label FROM service_items WHERE service = ?1 ORDER BY position",
    )?;
    for s in &mut services {
        s.items = items_stmt.query_map(params![s.id], item_from_row)?.collect::<rusqlite::Result<_>>()?;
    }
    Ok(services)
}

/// Creates an empty service and returns its id.
pub fn create_service(conn: &Connection, name: &str) -> Result<i64> {
    conn.execute("INSERT INTO services (name) VALUES (?1)", params![cleaned_name(name)])?;
    Ok(conn.last_insert_rowid())
}

pub fn rename_service(conn: &Connection, id: i64, name: &str) -> Result<()> {
    conn.execute(
        "UPDATE services SET name = ?2, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
        params![id, cleaned_name(name)],
    )?;
    Ok(())
}

/// Deletes a service and its items.
pub fn delete_service(conn: &Connection, id: i64) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM service_items WHERE service = ?1", params![id])?;
    tx.execute("DELETE FROM services WHERE id = ?1", params![id])?;
    tx.commit()?;
    Ok(())
}

/// Replaces a service's items with `items`, in the given order, and touches its `updated_at`.
pub fn save_service_items(conn: &Connection, id: i64, items: &[NewItem]) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM service_items WHERE service = ?1", params![id])?;
    for (position, item) in items.iter().enumerate() {
        tx.execute(
            "INSERT INTO service_items (service, position, book, chapter, verse, verse_end, label)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, position as i64, item.book, item.chapter, item.verse, item.verse_end, item.label],
        )?;
    }
    tx.execute("UPDATE services SET updated_at = CURRENT_TIMESTAMP WHERE id = ?1", params![id])?;
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
    fn creates_lists_and_deletes_services() {
        let c = conn();
        assert!(list_services(&c).unwrap().is_empty());
        let id = create_service(&c, "Sunday service").unwrap();
        let services = list_services(&c).unwrap();
        assert_eq!((services.len(), services[0].id, services[0].name.as_str()), (1, id, "Sunday service"));
        assert!(services[0].items.is_empty());

        delete_service(&c, id).unwrap();
        assert!(list_services(&c).unwrap().is_empty());
    }

    #[test]
    fn blank_names_fall_back_to_a_default() {
        let c = conn();
        let id = create_service(&c, "   ").unwrap();
        assert_eq!(list_services(&c).unwrap()[0].name, "Untitled service");
        rename_service(&c, id, "").unwrap();
        assert_eq!(list_services(&c).unwrap()[0].name, "Untitled service");
    }

    #[test]
    fn renaming_updates_the_name_only() {
        let c = conn();
        let id = create_service(&c, "Draft").unwrap();
        rename_service(&c, id, "Sunday, 9am").unwrap();
        let services = list_services(&c).unwrap();
        assert_eq!((services.len(), services[0].name.as_str()), (1, "Sunday, 9am"));
    }

    #[test]
    fn saving_items_stores_them_in_order() {
        let c = conn();
        let id = create_service(&c, "Service").unwrap();
        save_service_items(
            &c,
            id,
            &[
                NewItem { label: Some("Call to worship".into()), ..item(19, 100, 1) },
                item(43, 3, 16),
                NewItem { verse_end: Some(2), ..item(45, 8, 1) },
            ],
        )
        .unwrap();

        let items = &list_services(&c).unwrap()[0].items;
        assert_eq!(items.len(), 3);
        assert_eq!((items[0].book, items[0].chapter, items[0].verse, items[0].label.as_deref()), (19, 100, 1, Some("Call to worship")));
        assert_eq!((items[1].book, items[1].chapter, items[1].verse), (43, 3, 16));
        assert_eq!((items[2].book, items[2].verse_end), (45, Some(2)));
    }

    #[test]
    fn saving_items_again_replaces_the_previous_set() {
        let c = conn();
        let id = create_service(&c, "Service").unwrap();
        save_service_items(&c, id, &[item(43, 3, 16)]).unwrap();
        save_service_items(&c, id, &[item(19, 23, 1), item(19, 100, 5)]).unwrap();

        let items = &list_services(&c).unwrap()[0].items;
        assert_eq!(items.iter().map(|i| (i.book, i.verse)).collect::<Vec<_>>(), [(19, 1), (19, 5)]);
    }

    #[test]
    fn deleting_a_service_removes_its_items_and_leaves_others() {
        let c = conn();
        let a = create_service(&c, "A").unwrap();
        let b = create_service(&c, "B").unwrap();
        save_service_items(&c, a, &[item(43, 3, 16)]).unwrap();
        save_service_items(&c, b, &[item(19, 23, 1)]).unwrap();

        delete_service(&c, a).unwrap();
        let services = list_services(&c).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].id, b);
        let orphans: i64 = c.query_row("SELECT COUNT(*) FROM service_items WHERE service = ?1", params![a], |r| r.get(0)).unwrap();
        assert_eq!(orphans, 0);
    }
}
