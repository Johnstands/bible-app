//! Turning presentation files (PowerPoint, OpenDocument, Keynote) into a PDF with a program already
//! installed on the computer, so the webview can draw its pages like any other PDF (see
//! src/slideImport.ts, decks.rs). The app never reads these formats itself: the program that made
//! the slides, or one built to open them, draws them far more faithfully than we could.
//!
//! Three converters, tried best first (see `tools_for`):
//! - **PowerPoint** on Windows, driven through COM by a PowerShell script.
//! - **Keynote** on macOS (free on every Mac; opens PowerPoint files too), driven by AppleScript.
//! - **LibreOffice** anywhere, run headless.
//!
//! Every run works on a copy of the file under a fixed name in a scratch folder, takes the file
//! paths through environment variables or AppleScript arguments (never spliced into script or
//! command-line text), and is stopped, with everything it started, if it takes too long.

use crate::db::{Error, Result};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// File types sent through a converter; must match `OFFICE_EXTENSIONS` in src/slideImport.ts.
pub const OFFICE_EXTENSIONS: &[&str] = &["pptx", "ppt", "pptm", "ppsx", "pps", "odp", "key"];

/// How long a conversion may take before it's abandoned. Generous: a first run sets things up, and
/// a big deck with many pictures is slow.
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

/// Opens the file read-only and hidden, saves it as a PDF (`ppSaveAsPDF` = 32), and closes it. Quits
/// PowerPoint only if nothing else is open in it, so a presenter's own open decks are left alone.
const POWERPOINT_SCRIPT: &str = r#"$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
$pres = $null
try {
  # ReadOnly = msoTrue, Untitled = msoFalse, WithWindow = msoFalse
  $pres = $app.Presentations.Open($env:BIBLE_APP_INPUT, -1, 0, 0)
  $pres.SaveAs($env:BIBLE_APP_OUTPUT, 32)
} finally {
  if ($pres -ne $null) { $pres.Close() }
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
}
"#;

/// Opens the file, exports it as a PDF, closes it without saving, and quits Keynote if it wasn't
/// already running.
const KEYNOTE_SCRIPT: &str = r#"on run argv
  set inputFile to POSIX file (item 1 of argv)
  set outputFile to POSIX file (item 2 of argv)
  set wasRunning to application "Keynote" is running
  tell application "Keynote"
    set theDoc to open inputFile
    try
      export theDoc to outputFile as PDF
    on error message
      close theDoc saving no
      if not wasRunning then quit
      error message
    end try
    close theDoc saving no
    if not wasRunning then quit
  end tell
end run
"#;

/// Which installed program does the converting.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Converter {
    PowerPoint,
    Keynote,
    LibreOffice,
}

impl Converter {
    /// The name shown to the user ("Converting Sunday.pptx with Keynote…").
    pub fn label(self) -> &'static str {
        match self {
            Converter::PowerPoint => "PowerPoint",
            Converter::Keynote => "Keynote",
            Converter::LibreOffice => "LibreOffice",
        }
    }

    /// Whether it can open a file with this (lowercased) extension.
    fn opens(self, ext: &str) -> bool {
        match self {
            Converter::PowerPoint => ext != "key",
            Converter::Keynote => ext != "odp",
            Converter::LibreOffice => true,
        }
    }
}

/// An installed converter and the program that runs it (`soffice`, `powershell.exe` or `osascript`).
#[derive(Clone, Debug, PartialEq)]
pub struct Tool {
    pub converter: Converter,
    pub program: PathBuf,
}

pub fn is_office_file(path: &Path) -> bool {
    OFFICE_EXTENSIONS.contains(&extension(path).as_str())
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// The installed tools that can open a file with extension `ext`, best first. `tools` is what
/// `find_tools` found, already best first.
pub fn tools_for<'a>(ext: &str, tools: &'a [Tool]) -> Vec<&'a Tool> {
    tools.iter().filter(|t| t.converter.opens(ext)).collect()
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
        "macos" => mac_app_folders(home)
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

/// Where Mac apps are installed: for everyone, then just for this user.
fn mac_app_folders(home: Option<&Path>) -> impl Iterator<Item = PathBuf> {
    [Some(PathBuf::from("/Applications")), home.map(|h| h.join("Applications"))].into_iter().flatten()
}

/// Windows PowerShell, from the system folder rather than whatever `PATH` finds first.
fn powershell_program() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join(r"System32\WindowsPowerShell\v1.0\powershell.exe"))
        .filter(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from("powershell.exe"))
}

/// Whether PowerPoint's COM automation is registered, which is what the conversion script needs.
fn powerpoint_installed() -> bool {
    let mut query = Command::new("reg");
    query.args([r"query", r"HKCR\PowerPoint.Application\CurVer"]).stdout(Stdio::null()).stderr(Stdio::null());
    hide_window(&mut query);
    query.status().is_ok_and(|s| s.success())
}

/// The converters installed on this computer, best first.
pub fn find_tools() -> Vec<Tool> {
    let os = std::env::consts::OS;
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut tools = Vec::new();
    if os == "windows" && powerpoint_installed() {
        tools.push(Tool { converter: Converter::PowerPoint, program: powershell_program() });
    }
    if os == "macos" && mac_app_folders(home.as_deref()).any(|apps| apps.join("Keynote.app").is_dir()) {
        tools.push(Tool { converter: Converter::Keynote, program: PathBuf::from("/usr/bin/osascript") });
    }
    let program_files: Vec<PathBuf> = ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"]
        .iter()
        .filter_map(std::env::var_os)
        .map(PathBuf::from)
        .collect();
    if let Some(soffice) = libreoffice_candidates(os, std::env::var_os("PATH").as_deref(), &program_files, home.as_deref())
        .into_iter()
        .find(|p| p.is_file())
    {
        tools.push(Tool { converter: Converter::LibreOffice, program: soffice });
    }
    tools
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

/// Whether an Office Open XML file (.pptx and kin, normally a ZIP) is password-protected: Office
/// wraps encrypted files in an OLE compound file instead. Opening one would stop at a password
/// prompt nobody sees, so it's refused up front.
fn is_encrypted_ooxml(ext: &str, head: &[u8]) -> bool {
    const OLE: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    matches!(ext, "pptx" | "pptm" | "ppsx") && head.starts_with(OLE)
}

/// A scratch folder that's removed however the conversion ends.
struct WorkDir(PathBuf);

impl WorkDir {
    fn new(base: &Path) -> Result<Self> {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let dir = base.join(format!("convert-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir)?;
        Ok(WorkDir(dir))
    }
}

impl Drop for WorkDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// No console window flashing up on Windows while a converter runs.
fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// The command that converts `input` for `tool`, and where it leaves the PDF. Scripts are written
/// into `work`; file paths only ever travel as environment variables or script arguments.
fn command_for(tool: &Tool, work: &Path, input: &Path, profile: &Path) -> Result<(Command, PathBuf)> {
    let mut command = Command::new(&tool.program);
    let output = match tool.converter {
        Converter::LibreOffice => {
            let out_dir = work.join("out");
            command
                .arg(format!("-env:UserInstallation={}", file_url(profile)))
                .args(["--headless", "--invisible", "--norestore", "--nolockcheck", "--nodefault", "--nologo"])
                .args(["--convert-to", "pdf", "--outdir"])
                .arg(&out_dir)
                .arg(input);
            out_dir.join("input.pdf")
        }
        Converter::PowerPoint => {
            let script = work.join("convert.ps1");
            std::fs::write(&script, POWERPOINT_SCRIPT)?;
            let output = work.join("output.pdf");
            command
                .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script)
                .env("BIBLE_APP_INPUT", input)
                .env("BIBLE_APP_OUTPUT", &output);
            output
        }
        Converter::Keynote => {
            let script = work.join("convert.applescript");
            std::fs::write(&script, KEYNOTE_SCRIPT)?;
            let output = work.join("output.pdf");
            command.arg(&script).arg(input).arg(&output);
            output
        }
    };
    Ok((command, output))
}

/// Stops a process and everything it started: `soffice` is only a launcher, and killing just it
/// would leave the real LibreOffice running.
fn kill_tree(child: &mut std::process::Child) {
    let pid = child.id().to_string();
    #[cfg(unix)]
    let _ = Command::new("kill").args(["-KILL", &format!("-{pid}")]).status();
    #[cfg(windows)]
    {
        let mut taskkill = Command::new("taskkill");
        taskkill.args(["/T", "/F", "/PID", &pid]);
        hide_window(&mut taskkill);
        let _ = taskkill.status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// The end of what a converter printed, to say why it failed (PowerShell and AppleScript explain
/// themselves there).
fn log_tail(log: &Path) -> Option<String> {
    let text = std::fs::read_to_string(log).ok()?;
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let tail: String = text.chars().rev().take(300).collect::<Vec<_>>().into_iter().rev().collect();
    Some(tail.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Converts a presentation to PDF with `tool` and returns the PDF. The scratch folder goes under
/// `work_base`; `profile` is a folder LibreOffice may keep its settings in between runs (kept so
/// later runs start faster).
pub fn convert_to_pdf(source: &Path, tool: &Tool, work_base: &Path, profile: &Path, timeout: Duration) -> Result<Vec<u8>> {
    let name = source.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let label = tool.converter.label();
    let ext = extension(source);
    if !is_office_file(source) || !tool.converter.opens(&ext) {
        return Err(Error::Invalid(format!("{name} isn't a presentation {label} can open.")));
    }
    let mut head = [0u8; 8];
    let read = std::io::Read::read(&mut std::fs::File::open(source)?, &mut head)?;
    if is_encrypted_ooxml(&ext, &head[..read]) {
        return Err(Error::Invalid(format!(
            "{name} is password-protected. Save a copy without the password, or save it as a PDF, and add that."
        )));
    }

    let work = WorkDir::new(work_base)?;
    let input = work.0.join(format!("input.{ext}"));
    std::fs::copy(source, &input)?;
    let (mut command, output) = command_for(tool, &work.0, &input, profile)?;
    let log_path = work.0.join("log.txt");
    let log = std::fs::File::create(&log_path)?;
    command.stdin(Stdio::null()).stdout(log.try_clone()?).stderr(log);
    if std::env::var_os("APPIMAGE").is_some() {
        for var in APPIMAGE_ENV {
            command.env_remove(var);
        }
    }
    hide_window(&mut command);
    // Its own process group, so a hung conversion can be stopped along with everything it started.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn().map_err(|e| Error::Invalid(format!("{label} couldn't be started ({e}).")))?;
    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            break;
        }
        if started.elapsed() > timeout {
            kill_tree(&mut child);
            let hint = match tool.converter {
                Converter::LibreOffice => String::new(),
                _ => format!(" If {label} is showing a message, answer or close it."),
            };
            return Err(Error::Invalid(format!(
                "{label} took too long converting {name}.{hint} Or save it as a PDF and add that instead."
            )));
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    // Converters can exit successfully without converting, so what counts is the file.
    std::fs::read(&output).map_err(|_| {
        let details = log_tail(&log_path).map(|t| format!(" ({t})")).unwrap_or_default();
        Error::Invalid(format!(
            "{label} couldn't convert {name}. It may be damaged; try saving it as a PDF and adding that.{details}"
        ))
    })
}

/// Converts with the best tool that can open the file, falling back to the next if one fails.
/// With none installed, says what would help.
pub fn convert_with_best(source: &Path, tools: &[Tool], work_base: &Path, profile: &Path, timeout: Duration) -> Result<Vec<u8>> {
    let ext = extension(source);
    let candidates = tools_for(&ext, tools);
    let mut first_error = None;
    for tool in candidates {
        match convert_to_pdf(source, tool, work_base, profile, timeout) {
            Ok(pdf) => return Ok(pdf),
            // A password or a wrong file type won't go better with another program.
            Err(e) if e.to_string().contains("password-protected") => return Err(e),
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    Err(first_error.unwrap_or_else(|| {
        let needs = if ext == "key" { "Keynote (on a Mac) or LibreOffice" } else { "PowerPoint, Keynote or LibreOffice (free, from libreoffice.org)" };
        Error::Invalid(format!("Adding this kind of file needs {needs}. Or save it as a PDF and add that."))
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool(converter: Converter, program: &str) -> Tool {
        Tool { converter, program: PathBuf::from(program) }
    }

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
    fn picks_the_best_tool_that_opens_each_kind_of_file() {
        let all = [tool(Converter::PowerPoint, "ps"), tool(Converter::Keynote, "osa"), tool(Converter::LibreOffice, "so")];
        let order = |ext: &str| tools_for(ext, &all).iter().map(|t| t.converter).collect::<Vec<_>>();
        use Converter::*;
        assert_eq!(order("pptx"), [PowerPoint, Keynote, LibreOffice]);
        // Keynote files: not PowerPoint. OpenDocument: not Keynote.
        assert_eq!(order("key"), [Keynote, LibreOffice]);
        assert_eq!(order("odp"), [PowerPoint, LibreOffice]);
        assert!(tools_for("pptx", &[]).is_empty());
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
    fn spots_password_protected_powerpoint_files() {
        let ole = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        let zip = *b"PK\x03\x04\x14\x00\x06\x00";
        assert!(is_encrypted_ooxml("pptx", &ole));
        assert!(!is_encrypted_ooxml("pptx", &zip));
        // The old .ppt format is always a compound file, protected or not.
        assert!(!is_encrypted_ooxml("ppt", &ole));
        assert!(!is_encrypted_ooxml("pptx", &ole[..4]));
    }

    /// The PowerPoint and Keynote commands, checked for what they'd run, since they can only
    /// actually run on Windows and macOS.
    mod scripted_converters {
        use super::*;

        struct Work(PathBuf);
        impl Work {
            fn new(name: &str) -> Self {
                let dir = std::env::temp_dir().join(format!("bible-app-convert-cmd-{name}-{}", std::process::id()));
                let _ = std::fs::remove_dir_all(&dir);
                std::fs::create_dir_all(&dir).unwrap();
                Work(dir)
            }
        }
        impl Drop for Work {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        fn args(command: &Command) -> Vec<String> {
            command.get_args().map(|a| a.to_string_lossy().into_owned()).collect()
        }

        #[test]
        fn powerpoint_gets_its_paths_only_through_the_environment() {
            let work = Work::new("ppt");
            let input = work.0.join("input.pptx");
            let (command, output) = command_for(&tool(Converter::PowerPoint, "powershell.exe"), &work.0, &input, Path::new("/p")).unwrap();
            let script = work.0.join("convert.ps1");
            assert_eq!(args(&command), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", &script.to_string_lossy()]);
            let env: Vec<_> = command.get_envs().map(|(k, v)| (k.to_owned(), v.map(|v| v.to_owned()))).collect();
            assert!(env.contains(&("BIBLE_APP_INPUT".into(), Some(input.into_os_string()))));
            assert!(env.contains(&("BIBLE_APP_OUTPUT".into(), Some(output.clone().into_os_string()))));
            assert_eq!(output, work.0.join("output.pdf"));
            let text = std::fs::read_to_string(script).unwrap();
            assert!(text.contains("$pres.SaveAs($env:BIBLE_APP_OUTPUT, 32)"));
            assert!(text.contains("Presentations.Open($env:BIBLE_APP_INPUT, -1, 0, 0)"), "read-only, without a window");
            assert!(text.contains("if ($app.Presentations.Count -eq 0) { $app.Quit() }"), "leaves the user's own decks open");
        }

        #[test]
        fn keynote_gets_its_paths_as_script_arguments() {
            let work = Work::new("key");
            let input = work.0.join("input.key");
            let (command, output) = command_for(&tool(Converter::Keynote, "/usr/bin/osascript"), &work.0, &input, Path::new("/p")).unwrap();
            let script = work.0.join("convert.applescript");
            assert_eq!(args(&command), [script.to_string_lossy(), input.to_string_lossy(), output.to_string_lossy()]);
            let text = std::fs::read_to_string(script).unwrap();
            assert!(text.contains("export theDoc to outputFile as PDF"));
            assert!(text.contains("if not wasRunning then quit"));
        }
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
                std::fs::write(dir.join("Sunday service.pptx"), b"PK\x03\x04slides").unwrap();
                let script = dir.join("soffice");
                std::fs::write(
                    &script,
                    format!("#!/bin/sh\nwhile [ $# -gt 0 ]; do [ \"$1\" = --outdir ] && out=\"$2\"; shift; done\n{body}\n"),
                )
                .unwrap();
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
                Fake { dir }
            }

            fn soffice(&self) -> Tool {
                Tool { converter: Converter::LibreOffice, program: self.dir.join("soffice") }
            }

            fn convert_with(&self, tools: &[Tool], timeout: Duration) -> Result<Vec<u8>> {
                convert_with_best(&self.dir.join("Sunday service.pptx"), tools, &self.dir, &self.dir.join("profile"), timeout)
            }

            fn convert(&self, timeout: Duration) -> Result<Vec<u8>> {
                self.convert_with(&[self.soffice()], timeout)
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
            // The scratch folder is gone afterwards.
            assert!(!std::fs::read_dir(&fake.dir).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().starts_with("convert-")));
        }

        #[test]
        fn says_so_when_nothing_was_written_with_what_the_converter_said() {
            let fake = Fake::new("nothing", "echo 'Error: source file could not be loaded' >&2; exit 0");
            let err = fake.convert(TIMEOUT).unwrap_err().to_string();
            assert!(err.contains("LibreOffice couldn't convert Sunday service.pptx"), "{err}");
            assert!(err.ends_with("(Error: source file could not be loaded)"), "{err}");
        }

        #[test]
        fn falls_back_to_the_next_tool_when_the_best_one_fails() {
            let fake = Fake::new("fallback", r#"mkdir -p "$out" && printf '%%PDF-second' > "$out/input.pdf""#);
            let broken = Tool { converter: Converter::LibreOffice, program: fake.dir.join("missing-program") };
            assert_eq!(fake.convert_with(&[broken, fake.soffice()], TIMEOUT).unwrap(), b"%PDF-second");
        }

        #[test]
        fn refuses_password_protected_files_without_running_anything() {
            let fake = Fake::new("password", r#"touch "$(dirname "$0")/ran""#);
            std::fs::write(fake.dir.join("Sunday service.pptx"), [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0]).unwrap();
            let err = fake.convert(TIMEOUT).unwrap_err().to_string();
            assert!(err.contains("password-protected"), "{err}");
            assert!(!fake.dir.join("ran").exists());
        }

        #[test]
        fn says_what_would_help_when_nothing_can_convert() {
            let fake = Fake::new("none", "exit 0");
            let err = fake.convert_with(&[], TIMEOUT).unwrap_err().to_string();
            assert!(err.contains("needs PowerPoint, Keynote or LibreOffice"), "{err}");
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
        let Some(soffice) = find_tools().into_iter().find(|t| t.converter == Converter::LibreOffice) else {
            eprintln!("LibreOffice isn't installed; skipping the real conversion test");
            return;
        };
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/hymn.pptx");
        let base = std::env::temp_dir().join(format!("bible-app-lo-test-{}", std::process::id()));
        let pdf = convert_to_pdf(&fixture, &soffice, &base, &base.join("profile"), TIMEOUT).unwrap();
        let _ = std::fs::remove_dir_all(&base);
        assert!(pdf.starts_with(b"%PDF"));
        assert!(pdf.windows(8).any(|w| w == b"/Count 3"), "expected 3 pages");
    }
}
