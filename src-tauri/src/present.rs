//! Presentation-mode window lifecycle: placing the projected view on a second monitor when one is
//! connected, or full-screening the main window itself when there is only one display. Holds no
//! slide state — the control window pushes that directly to the presentation window by event
//! (see `src/presentation.ts` on the frontend); this module only ever answers "where does the
//! live view live right now".

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Monitor, WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "presentation";
const MAIN: &str = "main";

/// A monitor's geometry, decoupled from `tauri::Monitor` so `choose_external` can be unit-tested
/// without a real display attached.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MonitorInfo {
    pub position: (i32, i32),
    pub size: (u32, u32),
}

impl From<&Monitor> for MonitorInfo {
    fn from(m: &Monitor) -> Self {
        MonitorInfo { position: (m.position().x, m.position().y), size: (m.size().width, m.size().height) }
    }
}

/// The monitor to project onto: the first one that isn't the primary, or `None` when there is only
/// one display (or none at all). A single display is never treated as "external", even if the
/// primary monitor itself couldn't be identified.
pub fn choose_external(monitors: &[MonitorInfo], primary: Option<&MonitorInfo>) -> Option<MonitorInfo> {
    if monitors.len() < 2 {
        return None;
    }
    monitors.iter().find(|m| Some(*m) != primary).copied()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum PresentStatus {
    /// A dedicated window is fullscreen on another monitor.
    #[serde(rename_all = "camelCase")]
    Window { monitor_label: Option<String> },
    /// The main window itself is fullscreen (only one display was found).
    Inline,
    /// Nothing is being presented.
    Closed,
}

fn status_of(app: &AppHandle) -> PresentStatus {
    if let Some(w) = app.get_webview_window(LABEL) {
        let monitor_label = w.current_monitor().ok().flatten().and_then(|m| m.name().cloned());
        PresentStatus::Window { monitor_label }
    } else if app.get_webview_window(MAIN).map(|w| w.is_fullscreen().unwrap_or(false)).unwrap_or(false) {
        PresentStatus::Inline
    } else {
        PresentStatus::Closed
    }
}

/// Builds (or re-homes) the dedicated presentation window on `mon`, replacing an inline presentation
/// on `main` if there was one.
fn open_on_monitor(app: &AppHandle, mon: MonitorInfo) {
    if let Some(main) = app.get_webview_window(MAIN) {
        let _ = main.set_fullscreen(false);
    }
    let (x, y) = mon.position;
    let (w, h) = mon.size;
    if let Some(win) = app.get_webview_window(LABEL) {
        // Already open: just move it to the (possibly changed) monitor and re-fullscreen there.
        let _ = win.set_fullscreen(false);
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        let _ = win.set_fullscreen(true);
        let _ = win.show();
        return;
    }
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Presentation")
        .decorations(false)
        .skip_taskbar(true)
        .position(x as f64, y as f64)
        .inner_size(w as f64, h as f64)
        .build();
    let Ok(win) = built else { return };
    let _ = win.set_fullscreen(true);
    let closed_app = app.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { .. } = e {
            let _ = closed_app.emit_to(MAIN, "present://closed", ());
        }
    });
}

/// Opens or re-homes the live view: on an external monitor if one is connected, otherwise by
/// full-screening the main window. Idempotent, so it doubles as "redetect the display" when called
/// again (e.g. after a monitor is plugged in or removed mid-service). Every monitor/geometry call
/// degrades gracefully rather than panicking — an unplugged display must never crash the app.
#[tauri::command]
pub fn present_open(app: AppHandle) -> PresentStatus {
    let monitors: Vec<MonitorInfo> = app.available_monitors().ok().unwrap_or_default().iter().map(MonitorInfo::from).collect();
    let primary = app.primary_monitor().ok().flatten().map(|m| MonitorInfo::from(&m));

    match choose_external(&monitors, primary.as_ref()) {
        Some(mon) => open_on_monitor(&app, mon),
        None => {
            if let Some(w) = app.get_webview_window(LABEL) {
                let _ = w.close();
            }
            if let Some(main) = app.get_webview_window(MAIN) {
                let _ = main.set_fullscreen(true);
            }
        }
    }
    status_of(&app)
}

/// Stops presenting: closes the dedicated window if there is one, and un-fullscreens the main window.
#[tauri::command]
pub fn present_close(app: AppHandle) -> PresentStatus {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    if let Some(main) = app.get_webview_window(MAIN) {
        let _ = main.set_fullscreen(false);
    }
    PresentStatus::Closed
}

/// Where the live view currently lives, without changing anything — used to resync the control UI.
#[tauri::command]
pub fn present_status(app: AppHandle) -> PresentStatus {
    status_of(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mon(x: i32, y: i32, w: u32, h: u32) -> MonitorInfo {
        MonitorInfo { position: (x, y), size: (w, h) }
    }

    #[test]
    fn a_single_monitor_is_never_external() {
        let only = mon(0, 0, 1920, 1080);
        assert_eq!(choose_external(&[only], Some(&only)), None);
        assert_eq!(choose_external(&[only], None), None);
    }

    #[test]
    fn picks_whichever_monitor_is_not_the_primary() {
        let primary = mon(0, 0, 1920, 1080);
        let projector = mon(1920, 0, 1280, 720);
        assert_eq!(choose_external(&[primary, projector], Some(&primary)), Some(projector));
        assert_eq!(choose_external(&[projector, primary], Some(&primary)), Some(projector));
    }

    #[test]
    fn falls_back_to_the_first_monitor_when_the_primary_is_unknown() {
        let a = mon(0, 0, 1920, 1080);
        let b = mon(1920, 0, 1280, 720);
        assert_eq!(choose_external(&[a, b], None), Some(a));
    }

    #[test]
    fn no_monitors_is_handled_without_panicking() {
        assert_eq!(choose_external(&[], None), None);
        assert_eq!(choose_external(&[], Some(&mon(0, 0, 1, 1))), None);
    }
}
