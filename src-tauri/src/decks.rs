//! Slide decks for presentation-mode playlists: ordered sets of slide images, each deck a row in the
//! `decks` table plus a folder of image files under the app data dir:
//!
//! ```text
//! <app data>/decks/<deck id>/0001.png, 0002.jpg, …
//! ```
//!
//! The files are the app's own copies, so moving or deleting the original doesn't break a playlist.
//! A deck comes either from image files (copied as they are) or from a PDF, whose pages the webview
//! renders to PNGs with pdf.js and sends back in one body (see `split_frames`).
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

/// The most slides one deck may have: far more than any service needs, but a stop for a runaway PDF.
pub const MAX_SLIDES: usize = 500;

/// The largest PDF read for rendering (bytes).
const MAX_PDF_BYTES: u64 = 256 * 1024 * 1024;

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// Where one slide of a new deck comes from.
enum Slide<'a> {
    /// An image file, copied as is, with its (lowercased, accepted) extension.
    File(&'a Path, String),
    /// A PNG rendered by the webview.
    Png(&'a [u8]),
}

/// Stores `slides` as a new deck named `name` appended to the end of `playlist`, and returns its id.
/// All or nothing: on any failure no deck row, item or files are left.
fn create_deck(conn: &Connection, root: &Path, playlist: i64, name: &str, slides: &[Slide]) -> Result<i64> {
    if slides.len() > MAX_SLIDES {
        return Err(Error::Invalid(format!("That's {} slides; a set can have at most {MAX_SLIDES}.", slides.len())));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute("INSERT INTO decks (name, slide_count) VALUES (?1, ?2)", params![name, slides.len() as u32])?;
    let deck = tx.last_insert_rowid();
    let dir = root.join(deck.to_string());
    let stored = (|| -> Result<()> {
        // A folder left behind by a deck whose id SQLite has since reused must not leak old slides in.
        if dir.exists() {
            std::fs::remove_dir_all(&dir)?;
        }
        std::fs::create_dir_all(&dir)?;
        for (i, slide) in slides.iter().enumerate() {
            let stem = stem(i as u32 + 1);
            match slide {
                Slide::File(src, ext) => std::fs::copy(src, dir.join(format!("{stem}.{ext}"))).map(|_| ())?,
                Slide::Png(bytes) => std::fs::write(dir.join(format!("{stem}.png")), bytes)?,
            }
        }
        playlists::append_deck(&tx, playlist, deck)
    })();
    match stored {
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

/// Imports `paths` (images, in slide order) as a new deck appended to the end of `playlist`, and
/// returns the new deck's id.
pub fn import_images(conn: &Connection, root: &Path, playlist: i64, paths: &[PathBuf]) -> Result<i64> {
    if paths.is_empty() {
        return Err(Error::Invalid("No images were chosen.".into()));
    }
    let slides = paths
        .iter()
        .map(|p| {
            image_ext(p)
                .map(|ext| Slide::File(p, ext))
                .ok_or_else(|| Error::Invalid(format!("{} isn't a supported image (PNG, JPG, WebP or GIF).", p.display())))
        })
        .collect::<Result<Vec<_>>>()?;
    create_deck(conn, root, playlist, &deck_name(paths), &slides)
}

/// Splits a body of length-prefixed frames (each a little-endian u32 byte count, then that many
/// bytes) back into its frames. Anything malformed — a truncated length or frame — is refused.
pub fn split_frames(mut body: &[u8]) -> Result<Vec<&[u8]>> {
    let bad = || Error::Invalid("The rendered slides arrived damaged.".into());
    let mut frames = Vec::new();
    while !body.is_empty() {
        let (len, rest) = body.split_first_chunk::<4>().ok_or_else(bad)?;
        let len = u32::from_le_bytes(*len) as usize;
        if rest.len() < len {
            return Err(bad());
        }
        let (frame, rest) = rest.split_at(len);
        frames.push(frame);
        body = rest;
    }
    Ok(frames)
}

/// Imports a PDF's pages, rendered to PNGs by the webview, as a new deck at the end of `playlist`.
/// `body` is frames (see `split_frames`): the deck's name as UTF-8, then one PNG per page.
pub fn import_rendered(conn: &Connection, root: &Path, playlist: i64, body: &[u8]) -> Result<i64> {
    let frames = split_frames(body)?;
    let Some((name, pages)) = frames.split_first() else {
        return Err(Error::Invalid("The rendered slides arrived damaged.".into()));
    };
    let name = std::str::from_utf8(name).map_err(|_| Error::Invalid("The slides' name isn't valid text.".into()))?.trim();
    if pages.is_empty() {
        return Err(Error::Invalid("That PDF has no pages.".into()));
    }
    if !pages.iter().all(|p| p.starts_with(PNG_SIGNATURE)) {
        return Err(Error::Invalid("A rendered page isn't a PNG image.".into()));
    }
    let slides: Vec<Slide> = pages.iter().map(|p| Slide::Png(p)).collect();
    create_deck(conn, root, playlist, if name.is_empty() { "Slides" } else { name }, &slides)
}

/// A PDF's bytes, for the webview to render. Only `.pdf` files, and only up to a sane size, since
/// this is the one command that reads a file the user named.
pub fn read_pdf(path: &Path) -> Result<Vec<u8>> {
    let is_pdf = path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if !is_pdf {
        return Err(Error::Invalid(format!("{} isn't a PDF.", path.display())));
    }
    if std::fs::metadata(path)?.len() > MAX_PDF_BYTES {
        return Err(Error::Invalid(format!("{} is too large (over {} MB).", path.display(), MAX_PDF_BYTES / 1024 / 1024)));
    }
    Ok(std::fs::read(path)?)
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

    /// Frames `parts` the way src/slideImport.ts's `encodeFrames` does.
    fn frames(parts: &[&[u8]]) -> Vec<u8> {
        parts.iter().flat_map(|p| (p.len() as u32).to_le_bytes().into_iter().chain(p.iter().copied())).collect()
    }

    fn png(tag: &[u8]) -> Vec<u8> {
        [PNG_SIGNATURE, tag].concat()
    }

    #[test]
    fn splits_frames_and_refuses_damaged_bodies() {
        let body = frames(&[b"name", b"", b"page"]);
        assert_eq!(split_frames(&body).unwrap(), [b"name".as_slice(), b"", b"page"]);
        assert!(split_frames(&[]).unwrap().is_empty());
        assert!(split_frames(&body[..body.len() - 1]).is_err(), "truncated frame");
        assert!(split_frames(&[1, 0]).is_err(), "truncated length");
        assert!(split_frames(&[255, 255, 255, 255, 1]).is_err(), "length past the end");
    }

    #[test]
    fn imports_rendered_pdf_pages_as_pngs() {
        let tmp = TempDir::new("rendered");
        let root = tmp.0.join("decks");
        let (c, playlist) = conn_with_playlist();
        let (one, two) = (png(b"one"), png(b"two"));
        let deck = import_rendered(&c, &root, playlist, &frames(&[" Sunday.pdf ".as_bytes(), &one, &two])).unwrap();

        assert!(matches!(&list_playlists(&c).unwrap()[0].items[..], [PlaylistItem::Deck { name, slide_count: 2, .. }] if name == "Sunday.pdf"));
        let second = serve(Some(root.clone()), &format!("/{deck}/2"));
        assert_eq!(second.body(), &two);
        assert_eq!(second.headers()[header::CONTENT_TYPE], "image/png");
    }

    #[test]
    fn refuses_rendered_pages_that_are_not_pngs_or_missing() {
        let tmp = TempDir::new("rendered-bad");
        let root = tmp.0.join("decks");
        let (c, playlist) = conn_with_playlist();
        assert!(import_rendered(&c, &root, playlist, &frames(&[b"x.pdf"])).is_err(), "no pages");
        assert!(import_rendered(&c, &root, playlist, &frames(&[b"x.pdf", &png(b"ok"), b"<html>"])).is_err(), "not a PNG");
        assert!(import_rendered(&c, &root, playlist, &[]).is_err(), "empty body");
        assert!(import_rendered(&c, &root, playlist, &frames(&[&[0xff, 0xfe], &png(b"ok")])).is_err(), "name not UTF-8");
        let decks: i64 = c.query_row("SELECT COUNT(*) FROM decks", [], |r| r.get(0)).unwrap();
        assert_eq!(decks, 0);
    }

    #[test]
    fn a_deck_has_a_size_limit() {
        let tmp = TempDir::new("limit");
        let (c, playlist) = conn_with_playlist();
        let page = png(b"p");
        let mut parts: Vec<&[u8]> = vec![b"big.pdf"];
        parts.extend(std::iter::repeat_n(page.as_slice(), MAX_SLIDES + 1));
        assert!(import_rendered(&c, &tmp.0.join("decks"), playlist, &frames(&parts)).is_err());
    }

    #[test]
    fn reads_only_pdfs() {
        let tmp = TempDir::new("read-pdf");
        let pdf = tmp.write("Sunday.PDF", b"%PDF-1.4 ...");
        assert_eq!(read_pdf(&pdf).unwrap(), b"%PDF-1.4 ...");
        let other = tmp.write("secrets.txt", b"no");
        assert!(read_pdf(&other).is_err());
        assert!(read_pdf(&tmp.0.join("missing.pdf")).is_err());
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
