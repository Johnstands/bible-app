//! An AppImage carries its own copies of a few Wayland and graphics-support libraries, built for an
//! older distribution. Mixed with a newer system's Mesa (Arch, for one), WebKit aborts at startup
//! with `EGL_BAD_ALLOC`. When running from an AppImage we re-execute ourselves once with the
//! system's copies preloaded, so they win over the bundled ones. The web and network processes
//! inherit the setting.

// Only Linux calls into this; the pure part is still built (and tested) everywhere.
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::path::{Path, PathBuf};

const LIBS: [&str; 4] = [
    "libwayland-client.so.0",
    "libwayland-egl.so.1",
    "libwayland-cursor.so.0",
    "libepoxy.so.0",
];
const DIRS: [&str; 3] = ["/usr/lib", "/usr/lib64", "/usr/lib/x86_64-linux-gnu"];

/// Set on the re-executed process so we only do this once.
const MARKER: &str = "BIBLE_APP_SYSTEM_LIBS";

/// The `LD_PRELOAD` value that puts the system's copies first, keeping anything already set.
/// `None` when the system has none of them, in which case there is nothing to prefer.
fn preload_value(existing: Option<&str>, exists: impl Fn(&Path) -> bool) -> Option<String> {
    let mut found: Vec<PathBuf> = LIBS
        .iter()
        .filter_map(|lib| {
            DIRS.iter()
                .map(|dir| Path::new(dir).join(lib))
                .find(|p| exists(p))
        })
        .collect();
    if found.is_empty() {
        return None;
    }
    if let Some(existing) = existing.filter(|e| !e.is_empty()) {
        found.push(PathBuf::from(existing));
    }
    Some(
        found
            .iter()
            .map(|p| p.to_string_lossy())
            .collect::<Vec<_>>()
            .join(":"),
    )
}

/// Call first thing in `main`. Returns normally when nothing needs doing (not an AppImage, already
/// done, no system libraries) and also if the re-exec fails, so the app still tries to start.
#[cfg(target_os = "linux")]
pub fn prefer_system_libs() {
    use std::os::unix::process::CommandExt;

    if std::env::var_os("APPIMAGE").is_none() || std::env::var_os(MARKER).is_some() {
        return;
    }
    let existing = std::env::var("LD_PRELOAD").ok();
    let Some(value) = preload_value(existing.as_deref(), |p| p.exists()) else {
        return;
    };
    let mut args = std::env::args_os();
    let mut cmd = std::process::Command::new("/proc/self/exe");
    if let Some(argv0) = args.next() {
        cmd.arg0(argv0);
    }
    // `exec` only returns if it failed.
    let err = cmd
        .args(args)
        .env("LD_PRELOAD", value)
        .env(MARKER, "1")
        .exec();
    eprintln!("could not restart with system libraries: {err}");
}

#[cfg(not(target_os = "linux"))]
pub fn prefer_system_libs() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_to_prefer_when_the_system_has_none() {
        assert_eq!(preload_value(None, |_| false), None);
        assert_eq!(preload_value(Some("/x.so"), |_| false), None);
    }

    #[test]
    fn takes_the_first_directory_that_has_each_library() {
        let value = preload_value(None, |p| {
            p == Path::new("/usr/lib64/libepoxy.so.0")
                || p == Path::new("/usr/lib/libwayland-client.so.0")
                || p == Path::new("/usr/lib/x86_64-linux-gnu/libwayland-client.so.0")
        })
        .unwrap();
        assert_eq!(
            value,
            "/usr/lib/libwayland-client.so.0:/usr/lib64/libepoxy.so.0"
        );
    }

    #[test]
    fn keeps_an_existing_preload_after_ours() {
        let value = preload_value(Some("/opt/other.so"), |p| {
            p == Path::new("/usr/lib/libwayland-egl.so.1")
        })
        .unwrap();
        assert_eq!(value, "/usr/lib/libwayland-egl.so.1:/opt/other.so");
    }

    #[test]
    fn an_empty_existing_preload_is_ignored() {
        let value = preload_value(Some(""), |p| p == Path::new("/usr/lib/libepoxy.so.0")).unwrap();
        assert_eq!(value, "/usr/lib/libepoxy.so.0");
    }
}
