//! Turning presentation files (PowerPoint, OpenDocument, Keynote) into a PDF with an office suite
//! already installed on the computer, so the webview can draw its pages like any other PDF (see
//! src/slideImport.ts, decks.rs). The app never reads these formats itself: the program that made
//! the slides, or one built to open them, draws them far more faithfully than we could.
//!
//! LibreOffice is the one converter so far. It runs headless, on a copy of the file under a fixed
//! name (so no user-chosen text ever reaches its command line), with a profile of its own (so it
//! can't collide with a LibreOffice window the user already has open), and under a time limit.

use crate::db::{Error, Result};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// File types sent through a converter; must match `OFFICE_EXTENSIONS` in src/slideImport.ts.
pub const OFFICE_EXTENSIONS: &[&str] = &["pptx", "ppt", "pptm", "ppsx", "pps", "odp", "key"];

/// How long a conversion may take before it's abandoned. Generous: a first run sets up the profile,
/// and a big deck with many pictures is slow.
pub const TIMEOUT: Duration = Duration::from_secs(180);

/// Environment an AppImage sets up for its own bundled libraries, which would break another
/// program started from it (LibreOffice is a GTK app with its own Python).
const APPIMAGE_ENV: &[&str] = &[
    "LD_LIBRARY_PATH",
    "LD_PRELOAD",
    "GTK_PATH",
    "GTK_EXE_PREFIX",
    "GTK_DATA_PREFIX",
    "GTK_IM_MODULE_FILE",
    "GDK_PIXBUF_MODULE_FILE",
    "GDK_PIXBUF_MODULEDIR",
    "GIO_MODULE_DIR",
    "GIO_EXTRA_MODULES",
    "GSETTINGS_SCHEMA_DIR",
    "PYTHONHOME",
    "PYTHONPATH",
];

/// Which installed program does the converting.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Converter {
    LibreOffice,
}

impl Converter {
    /// The name shown to the user ("Converting Sunday.pptx with LibreOffice…").
    pub fn label(self) -> &'static str {
        match self {
            Converter::LibreOffice => "LibreOffice",
        }
    }
}

pub fn is_office_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| OFFICE_EXTENSIONS.iter().any(|o| e.eq_ignore_ascii_case(o)))
}

/// Where LibreOffice's `soffice` program might be, most likely first. Pure, so every platform's
/// list can be tested anywhere: `os` is `std::env::consts::OS`, `path_var` the `PATH` variable,
/// `program_files` the Windows Program Files folders and `home` the user's home folder.
fn libreoffice_candidates(os: &str, path_var: Option<&OsStr>, program_files: &[PathBuf], home: Option<&Path>) -> Vec<PathBuf> {
    let on_path = |names: &[&str]| -> Vec<PathBuf> {
        path_var
            .map(|p| std::env::split_paths(p).flat_map(|dir| names.iter().map(move |n| dir.join(n))).collect())
            .unwrap_or_default()
    };
    match os {
        "windows" => program_files
            .iter()
            .map(|pf| pf.join("LibreOffice").join("program").join("soffice.exe"))
            .chain(on_path(&["soffice.exe"]))
            .collect(),
        "macos" => [Some(PathBuf::from("/Applications")), home.map(|h| h.join("Applications"))]
            .into_iter()
            .flatten()
            .map(|apps| apps.join("LibreOffice.app/Contents/MacOS/soffice"))
            .chain(on_path(&["soffice"]))
            .collect(),
        _ => on_path(&["soffice", "libreoffice"])
            .into_iter()
            .chain(
                ["/usr/bin/soffice", "/usr/lib/libreoffice/program/soffice", "/opt/libreoffice/program/soffice", "/snap/bin/libreoffice"]
                    .map(PathBuf::from),
            )
            .collect(),
    }
}

/// The converter to use on this computer and its program, or `None` if there's none installed.
pub fn find_converter() -> Option<(Converter, PathBuf)> {
    let program_files: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    let home = std::env::var_os("HOME").map(PathBuf::from);
    libreoffice_candidates(std::env::consts::OS, std::env::var_os("PATH").as_deref(), &program_files, home.as_deref())
        .into_iter()
        .find(|p| p.is_file())
        .map(|p| (Converter::LibreOffice, p))
}

/// A `file://` URL for a local folder, as LibreOffice's `-env:UserInstallation` wants it, on any
/// platform (`C:\a b` becomes `file:///C:/a%20b`).
fn file_url(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    let mut url = String::from(if text.starts_with('/') { "file://" } else { "file:///" });
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~/:".contains(&b) {
            url.push(b as char);
        } else {
            url.push_str(&format!("%{b:02X}"));
        }
    }
    url
}

/// A scratch folder that's removed however the conversion ends.
struct WorkDir(PathBuf);

impl WorkDir {
    fn new() -> Result<Self> {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("bible-app-convert-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        Ok(WorkDir(dir))
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Stops a process and everything it started: `soffice` is only a launcher, and killing just it
/// would leave the real LibreOffice running.
fn kill_tree(child: &mut std::process::Child) {
    let pid = child.id().to_string();
    #[cfg(unix)]
    let _ = Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &pid]).creation_flags(0x0800_0000).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// Converts a presentation to PDF with `program` (LibreOffice's `soffice`) and returns the PDF.
/// `profile` is a folder LibreOffice may keep its settings in between runs (kept so later runs
/// start faster).
pub fn convert_to_pdf(source: &Path, program: &Path, profile: &Path, timeout: Duration) -> Result<Vec<u8>> {
    let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !is_office_file(source) {
        return Err(Error::Invalid(format!("{name} isn't a presentation LibreOffice can open.")));
    }
    let ext = source.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    let work = WorkDir::new()?;
    let input = work.0.join(format!("input.{ext}"));
    std::fs::copy(source, &input)?;
    let out_dir = work.0.join("out");
    let log = std::fs::File::create(work.0.join("log.txt"))?;

    let mut command = Command::new(program);
    command
        .arg(format!("-env:UserInstallation={}", file_url(profile)))
        .args(["--headless", "--invisible", "--norestore", "--nolockcheck", "--nodefault", "--nologo"])
        .args(["--convert-to", "pdf", "--outdir"])
        .arg(&out_dir)
        .arg(&input)
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    if std::env::var_os("APPIMAGE").is_some() {
        for var in APPIMAGE_ENV {
            command.env_remove(var);
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    // Its own process group, so a hung conversion can be stopped along with everything it started.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command
        .spawn()
        .map_err(|e| Error::Invalid(format!("LibreOffice couldn't be started ({e}).")))?;
    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if started.elapsed() > timeout {
            kill_tree(&mut child);
            return Err(Error::Invalid(format!(
                "LibreOffice took too long converting {name}. Try saving it as a PDF and adding that instead."
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // LibreOffice exits successfully even when it couldn't convert, so what counts is the file.
    std::fs::read(out_dir.join("input.pdf")).map_err(|_| {
        Error::Invalid(format!(
            "LibreOffice couldn't convert {name}. It may be damaged or password-protected; try saving it as a PDF and adding that."
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_presentation_files_whatever_the_case() {
        for ok in ["a.pptx", "b.PPT", "c.odp", "d.Key", "e.ppsx"] {
            assert!(is_office_file(Path::new(ok)), "{ok}");
        }
        for not in ["a.pdf", "b.png", "pptx", "c.pptx.txt", "d.docx"] {
            assert!(!is_office_file(Path::new(not)), "{not}");
        }
    }

    #[test]
    fn looks_for_libreoffice_where_each_platform_installs_it() {
        let linux = libreoffice_candidates("linux", Some(OsStr::new("/home/me/bin:/usr/local/bin")), &[], None);
        assert_eq!(linux[0], Path::new("/home/me/bin/soffice"));
        assert!(linux.contains(&PathBuf::from("/usr/local/bin/libreoffice")));
        assert!(linux.contains(&PathBuf::from("/usr/lib/libreoffice/program/soffice")));

        let mac = libreoffice_candidates("macos", None, &[], Some(Path::new("/Users/me")));
        assert_eq!(
            mac,
            [
                PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
                PathBuf::from("/Users/me/Applications/LibreOffice.app/Contents/MacOS/soffice"),
            ]
        );

        let windows = libreoffice_candidates("windows", None, &[PathBuf::from(r"C:\Program Files")], None);
        assert_eq!(windows, [Path::new(r"C:\Program Files").join("LibreOffice").join("program").join("soffice.exe")]);
    }

    #[test]
    fn makes_file_urls_for_libreoffice() {
        assert_eq!(file_url(Path::new("/home/me/.cache/bible app/lo")), "file:///home/me/.cache/bible%20app/lo");
        assert_eq!(file_url(Path::new(r"C:\Users\José\lo")), "file:///C:/Users/Jos%C3%A9/lo");
    }

    #[test]
    fn refuses_files_that_are_not_presentations() {
        let err = convert_to_pdf(Path::new("/tmp/notes.txt"), Path::new("/bin/true"), Path::new("/tmp"), TIMEOUT).unwrap_err();
        assert!(err.to_string().contains("isn't a presentation"));
    }

    /// Stand-ins for `soffice`: shell scripts that do what a conversion does, or fail to.
    #[cfg(unix)]
    mod with_a_fake_converter {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        struct Fake {
            dir: PathBuf,
        }

        impl Fake {
            /// A folder with a presentation to convert and an executable `soffice` running `body`
            /// after `$out` is set to the requested output folder.
            fn new(name: &str, body: &str) -> Self {
                let dir = std::env::temp_dir().join(format!("bible-app-fake-soffice-{name}-{}", std::process::id()));
                let _ = std::fs::remove_dir_all(&dir);
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(dir.join("Sunday service.pptx"), b"slides").unwrap();
                let script = dir.join("soffice");
                std::fs::write(
                    &script,
                    format!("#!/bin/sh\nwhile [ $# -gt 0 ]; do [ \"$1\" = --outdir ] && out=\"$2\"; shift; done\n{body}\n"),
                )
                .unwrap();
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
                Fake { dir }
            }

            fn convert(&self, timeout: Duration) -> Result<Vec<u8>> {
                convert_to_pdf(&self.dir.join("Sunday service.pptx"), &self.dir.join("soffice"), &self.dir.join("profile"), timeout)
            }
        }

        impl Drop for Fake {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.dir);
            }
        }

        #[test]
        fn returns_the_pdf_the_converter_wrote() {
            let fake = Fake::new("ok", r#"mkdir -p "$out" && printf '%%PDF-fake' > "$out/input.pdf""#);
            assert_eq!(fake.convert(TIMEOUT).unwrap(), b"%PDF-fake");
        }

        #[test]
        fn says_so_when_nothing_was_written() {
            let fake = Fake::new("nothing", "exit 0");
            let err = fake.convert(TIMEOUT).unwrap_err().to_string();
            assert!(err.contains("couldn't convert Sunday service.pptx"), "{err}");
        }

        #[test]
        fn gives_up_on_a_converter_that_hangs_and_stops_what_it_started() {
            // Like soffice: a launcher that starts the real work as a child and waits for it.
            let fake = Fake::new("hang", r#"sleep 30 & echo $! > "$(dirname "$0")/child.pid"; wait"#);
            let started = Instant::now();
            let err = fake.convert(Duration::from_millis(500)).unwrap_err().to_string();
            assert!(err.contains("took too long"), "{err}");
            assert!(started.elapsed() < Duration::from_secs(5));

            let child: u32 = std::fs::read_to_string(fake.dir.join("child.pid")).unwrap().trim().parse().unwrap();
            // `kill -0` succeeds only while the process exists.
            let alive = || Command::new("kill").args(["-0", &child.to_string()]).stderr(Stdio::null()).status().unwrap().success();
            let deadline = Instant::now() + Duration::from_secs(2);
            while alive() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(50));
            }
            assert!(!alive(), "the converter's child process was left running");
        }
    }

    /// The real thing, when LibreOffice is installed (it's skipped, with a note, when it isn't).
    #[test]
    fn converts_a_real_pptx_with_libreoffice() {
        let Some((Converter::LibreOffice, program)) = find_converter() else {
            eprintln!("LibreOffice isn't installed; skipping the real conversion test");
            return;
        };
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hymn.pptx");
        let profile = std::env::temp_dir().join(format!("bible-app-lo-profile-test-{}", std::process::id()));
        let pdf = convert_to_pdf(&fixture, &program, &profile, TIMEOUT).unwrap();
        let _ = std::fs::remove_dir_all(&profile);
        assert!(pdf.starts_with(b"%PDF"));
        assert!(pdf.windows(8).any(|w| w == b"/Count 3"), "expected 3 pages");
    }
}
