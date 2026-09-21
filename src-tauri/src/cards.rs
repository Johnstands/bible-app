//! Saving a verse card (a PNG the reader made) to disk.

use crate::db::{Error, Result};
use std::path::{Path, PathBuf};

/// The folder, inside the user's Pictures, that cards are saved to.
pub const FOLDER: &str = "Bible verse cards";

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
const MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_NAME_CHARS: usize = 100;

/// A file name that is safe on every system: letters, digits, spaces, dashes and underscores from `name`, always
/// ending in `.png`, never empty. Path separators and other punctuation are dropped, so it cannot leave its folder.
pub fn safe_name(name: &str) -> String {
    let stem = name.trim();
    let stem = stem
        .get(..stem.len().saturating_sub(4))
        .filter(|_| stem.to_ascii_lowercase().ends_with(".png"))
        .unwrap_or(stem);
    let cleaned: String = stem
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '-' | '_'))
        .take(MAX_NAME_CHARS)
        .collect();
    let cleaned = cleaned.trim();
    format!("{}.png", if cleaned.is_empty() { "verse" } else { cleaned })
}

/// `dir/name`, or `dir/name (2).png`, `(3)` and so on when that file already exists, so a card is never overwritten.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let stem = name.strip_suffix(".png").unwrap_or(name);
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}).png")))
        .find(|p| !p.exists())
        .expect("an unused name exists")
}

/// Writes a PNG into `dir` (created if needed) under a safe, unused name and returns where it went.
pub fn save_png(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<PathBuf> {
    if !bytes.starts_with(&PNG_SIGNATURE) {
        return Err(Error::Invalid("that is not a PNG image".into()));
    }
    if bytes.len() > MAX_BYTES {
        return Err(Error::Invalid("that image is too large".into()));
    }
    std::fs::create_dir_all(dir)?;
    let path = unique_path(dir, &safe_name(file_name));
    std::fs::write(&path, bytes)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A folder that is removed afterwards.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let nanos = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            Scratch(std::env::temp_dir().join(format!("kjv-cards-{}-{nanos}", std::process::id())))
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn png() -> Vec<u8> {
        let mut b = PNG_SIGNATURE.to_vec();
        b.extend_from_slice(b"not a real image, only the signature matters here");
        b
    }

    #[test]
    fn names_are_plain_and_end_in_png() {
        assert_eq!(safe_name("John 3-16.png"), "John 3-16.png");
        assert_eq!(safe_name("John 3-16"), "John 3-16.png");
        assert_eq!(safe_name("  John 3-16.PNG "), "John 3-16.png");
        assert_eq!(safe_name("1 John 4-9-10.png"), "1 John 4-9-10.png");
        assert_eq!(safe_name("Ψαλμός 23.png"), "Ψαλμός 23.png");
    }

    #[test]
    fn names_cannot_leave_the_folder() {
        for bad in [
            "../../etc/passwd",
            "..\\..\\evil.exe",
            "/abs/path.png",
            "a/b\\c.png",
            "..",
            ".",
            "***",
            "",
        ] {
            let name = safe_name(bad);
            assert!(name.ends_with(".png"), "{bad:?} -> {name}");
            assert!(
                !name.contains(['/', '\\']) && !name.starts_with('.'),
                "{bad:?} -> {name}"
            );
        }
        assert_eq!(safe_name(""), "verse.png");
        assert_eq!(safe_name("..."), "verse.png");
        assert_eq!(safe_name("../../etc/passwd"), "etcpasswd.png");
    }

    #[test]
    fn long_names_are_cut() {
        let name = safe_name(&"a".repeat(500));
        assert_eq!(name.chars().count(), MAX_NAME_CHARS + 4);
    }

    #[test]
    fn saving_creates_the_folder_and_writes_the_bytes() {
        let scratch = Scratch::new();
        let dir = scratch.0.join("nested").join(FOLDER);
        let path = save_png(&dir, "John 3-16.png", &png()).unwrap();
        assert_eq!(path, dir.join("John 3-16.png"));
        assert_eq!(std::fs::read(&path).unwrap(), png());
    }

    #[test]
    fn a_saved_card_is_never_overwritten() {
        let scratch = Scratch::new();
        let first = save_png(&scratch.0, "Psalm 23-1.png", &png()).unwrap();
        let second = save_png(&scratch.0, "Psalm 23-1.png", &png()).unwrap();
        let third = save_png(&scratch.0, "Psalm 23-1", &png()).unwrap();
        assert_eq!(first.file_name().unwrap(), "Psalm 23-1.png");
        assert_eq!(second.file_name().unwrap(), "Psalm 23-1 (2).png");
        assert_eq!(third.file_name().unwrap(), "Psalm 23-1 (3).png");
    }

    #[test]
    fn only_png_images_are_written() {
        let scratch = Scratch::new();
        assert!(save_png(&scratch.0, "x.png", b"<html>hello</html>").is_err());
        assert!(save_png(&scratch.0, "x.png", b"").is_err());
        assert!(
            !scratch.0.exists(),
            "nothing is created for a rejected file"
        );
        let mut huge = png();
        huge.resize(MAX_BYTES + 1, 0);
        assert!(save_png(&scratch.0, "x.png", &huge).is_err());
    }
}
