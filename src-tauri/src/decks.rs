//! Slide decks for presentation-mode playlists: ordered sets of slide images, each deck a row in the
//! `decks` table plus a folder of image files under the app data dir:
//!
//! ```text
//! <app data>/decks/<deck id>/0001.png, 0002.jpg, …
//! ```
//!
//! The files are the app's own copies, so moving or deleting the original doesn't break a playlist.
//! Both webviews (the control window and the projection window) load them through the `slides://`
//! URI scheme registered in lib.rs, which only ever serves files from inside this folder.

use crate::db::{Error, Result};
use crate::playlists;
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use tauri::http::{header, Response, StatusCode};

/// The folder under the app data dir that holds every deck's images.
pub const DIR: &str = "decks";

/// The URI scheme the webviews load slide images from; must match `SLIDES_SCHEME` in src/api.ts.
pub const SCHEME: &str = "slides";

/// Image types accepted as slides, lowercased, with what to serve them as.
const IMAGE_TYPES: &[(&str, &str)] = &[
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("webp", "image/webp"),
    ("gif", "image/gif"),
];

fn content_type(ext: &str) -> Option<&'static str> {
    IMAGE_TYPES.iter().find(|(e, _)| *e == ext).map(|(_, t)| *t)
}

/// The lowercased extension of `path`, if it's an image type we accept.
fn image_ext(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    content_type(&ext).map(|_| ext)
}

/// The file name a deck's `n`th slide (1-based) is stored under, before its extension.
fn stem(n: u32) -> String {
    format!("{n:04}")
}

/// A name for a deck made from `paths`: the file's own name for one image, else the first one's
/// name and how many more there are.
fn deck_name(paths: &[PathBuf]) -> String {
    let first = paths[0].file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "Slides".into());
    match paths.len() {
        1 => first,
        n => format!("{first} + {} more", n - 1),
    }
}

/// Imports `paths` (images, in slide order) as a new deck appended to the end of `playlist`, and
/// returns the new deck's id. All or nothing: on any failure no deck row, item or files are left.
pub fn import_images(conn: &Connection, root: &Path, playlist: i64, paths: &[PathBuf]) -> Result<i64> {
    if paths.is_empty() {
        return Err(Error::Invalid("No images were chosen.".into()));
    }
    let exts = paths
        .iter()
        .map(|p| image_ext(p).ok_or_else(|| Error::Invalid(format!("{} isn't a supported image (PNG, JPG, WebP or GIF).", p.display()))))
        .collect::<Result<Vec<_>>>()?;

    let tx = conn.unchecked_transaction()?;
    tx.execute("INSERT INTO decks (name, slide_count) VALUES (?1, ?2)", params![deck_name(paths), paths.len() as u32])?;
    let deck = tx.last_insert_rowid();
    let dir = root.join(deck.to_string());
    let copied = (|| -> Result<()> {
        // A folder left behind by a deck whose id SQLite has since reused must not leak old slides in.
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        std::fs::create_dir_all(&dir)?;
        for (i, (src, ext)) in paths.iter().zip(&exts).enumerate() {
            std::fs::copy(src, dir.join(format!("{}.{ext}", stem(i as u32 + 1))))?;
        }
        playlists::append_deck(&tx, playlist, deck)
    })();
    match copied {
        Ok(()) => {
            tx.commit()?;
            Ok(deck)
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            Err(e)
        }
    }
}

/// Removes the image folders of decks that were deleted from the DB. Best effort: a folder that
/// can't be removed now is only wasted disk space, never a wrong slide (if SQLite later reuses the
/// id, `import_images` clears the stale folder first).
pub fn delete_files(root: &Path, decks: &[i64]) {
    for deck in decks {
        let _ = std::fs::remove_dir_all(root.join(deck.to_string()));
    }
}

/// The deck id and 1-based slide number a `slides://` request asks for. Accepts both `/12/3` and the
/// percent-encoded `/12%2F3` that `convertFileSrc` produces, and nothing else, so a request can never
/// name a path outside the decks folder.
fn parse_request_path(path: &str) -> Option<(i64, u32)> {
    let path = path.strip_prefix('/')?.replace("%2F", "/").replace("%2f", "/");
    let (deck, n) = path.split_once('/')?;
    let all_digits = |s: &str| !s.is_empty() && s.len() <= 12 && s.bytes().all(|b| b.is_ascii_digit());
    if !all_digits(deck) || !all_digits(n) {
        return None;
    }
    let (deck, n) = (deck.parse().ok()?, n.parse().ok()?);
    (n >= 1).then_some((deck, n))
}

/// The stored file for a deck's `n`th slide, whatever its extension, and its content type.
fn slide_file(root: &Path, deck: i64, n: u32) -> Option<(PathBuf, &'static str)> {
    let want = stem(n);
    std::fs::read_dir(root.join(deck.to_string())).ok()?.flatten().find_map(|entry| {
        let path = entry.path();
        let ext = image_ext(&path)?;
        (path.file_stem()?.to_str()? == want).then(|| (path, content_type(&ext).unwrap()))
    })
}

/// Answers a `slides://` request: the slide image, or 404.
pub fn serve(root: Option<PathBuf>, request_path: &str) -> Response<Vec<u8>> {
    let found = root.zip(parse_request_path(request_path)).and_then(|(root, (deck, n))| slide_file(&root, deck, n));
    let not_found = || Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()).unwrap();
    let Some((path, kind)) = found else { return not_found() };
    match std::fs::read(path) {
        Ok(bytes) => Response::builder()
            .header(header::CONTENT_TYPE, kind)
            // A deck's images never change: re-importing makes a new deck with a new id.
            .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
            .body(bytes)
            .unwrap(),
        Err(_) => not_found(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::playlists::{list_playlists, PlaylistItem};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("bible-app-decks-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            TempDir(dir)
        }
        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let p = self.0.join(name);
            std::fs::write(&p, bytes).unwrap();
            p
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn conn_with_playlist() -> (Connection, i64) {
        let c = crate::user::open(Path::new(":memory:")).unwrap();
        let id = playlists::create_playlist(&c, "Sunday").unwrap();
        (c, id)
    }

    #[test]
    fn imports_images_in_order_and_serves_them() {
        let tmp = TempDir::new("import");
        let root = tmp.0.join("decks");
        let (c, playlist) = conn_with_playlist();
        let a = tmp.write("Welcome.PNG", b"first");
        let b = tmp.write("verse.jpg", b"second");

        let deck = import_images(&c, &root, playlist, &[a, b]).unwrap();
        let items = &list_playlists(&c).unwrap()[0].items;
        assert!(matches!(&items[..], [PlaylistItem::Deck { deck: d, name, slide_count: 2, .. }] if *d == deck && name == "Welcome.PNG + 1 more"));

        let first = serve(Some(root.clone()), &format!("/{deck}/1"));
        assert_eq!((first.status(), first.body().as_slice()), (StatusCode::OK, b"first".as_slice()));
        assert_eq!(first.headers()[header::CONTENT_TYPE], "image/png");
        // The percent-encoded form convertFileSrc produces.
        let second = serve(Some(root.clone()), &format!("/{deck}%2F2"));
        assert_eq!(second.body().as_slice(), b"second");
        assert_eq!(second.headers()[header::CONTENT_TYPE], "image/jpeg");
        assert_eq!(serve(Some(root.clone()), &format!("/{deck}/3")).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn a_single_image_is_named_after_its_file() {
        let tmp = TempDir::new("single");
        let (c, playlist) = conn_with_playlist();
        let img = tmp.write("Announcements.webp", b"x");
        import_images(&c, &tmp.0.join("decks"), playlist, &[img]).unwrap();
        assert!(matches!(&list_playlists(&c).unwrap()[0].items[0], PlaylistItem::Deck { name, slide_count: 1, .. } if name == "Announcements.webp"));
    }

    #[test]
    fn a_failed_import_leaves_nothing_behind() {
        let tmp = TempDir::new("failed");
        let root = tmp.0.join("decks");
        let (c, playlist) = conn_with_playlist();
        let good = tmp.write("a.png", b"a");

        // Not an image: refused before anything is written.
        let doc = tmp.write("notes.txt", b"x");
        assert!(import_images(&c, &root, playlist, &[good.clone(), doc]).is_err());
        // A file that vanished before it could be copied: the half-made deck is rolled back.
        assert!(import_images(&c, &root, playlist, &[good.clone(), tmp.0.join("missing.png")]).is_err());
        // Into a playlist that doesn't exist.
        assert!(import_images(&c, &root, 999, &[good]).is_err());
        assert!(import_images(&c, &root, playlist, &[]).is_err());

        let decks: i64 = c.query_row("SELECT COUNT(*) FROM decks", [], |r| r.get(0)).unwrap();
        assert_eq!(decks, 0);
        assert!(list_playlists(&c).unwrap()[0].items.is_empty());
        let leftover = std::fs::read_dir(&root).map(|d| d.count()).unwrap_or(0);
        assert_eq!(leftover, 0);
    }

    #[test]
    fn deleting_files_removes_only_the_named_decks() {
        let tmp = TempDir::new("delete");
        let root = tmp.0.join("decks");
        let (c, playlist) = conn_with_playlist();
        let img = tmp.write("a.png", b"a");
        let one = import_images(&c, &root, playlist, &[img.clone()]).unwrap();
        let two = import_images(&c, &root, playlist, &[img]).unwrap();

        delete_files(&root, &[one]);
        assert_eq!(serve(Some(root.clone()), &format!("/{one}/1")).status(), StatusCode::NOT_FOUND);
        assert_eq!(serve(Some(root.clone()), &format!("/{two}/1")).status(), StatusCode::OK);
    }

    #[test]
    fn requests_outside_the_decks_folder_are_refused() {
        for bad in ["", "/", "/1", "/1/", "/1/0", "/../1", "/1/../../user.db", "/1/2/3", "/a/1", "/1/1.png", "/-1/1", "1/1", "/1%2F..%2Fx"] {
            assert_eq!(parse_request_path(bad), None, "{bad:?}");
        }
        assert_eq!(parse_request_path("/7/12"), Some((7, 12)));
        assert_eq!(parse_request_path("/7%2f12"), Some((7, 12)));
        assert_eq!(serve(None, "/1/1").status(), StatusCode::NOT_FOUND);
    }
}
