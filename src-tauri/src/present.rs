//! Presentation-mode window lifecycle: a dedicated "presentation" window always exists while
//! presenting, fullscreen on a second monitor when one is connected, or left as an ordinary window
//! for the operator to place when there is only one display. The main window is never taken over.
//! Holds no slide state — the control window pushes that directly to the presentation window by
//! event (see `src/presentation.ts` on the frontend); this module only ever answers "where does the
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

/// Where the dedicated presentation window is right now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentStatus {
    /// Whether the presentation window currently exists.
    pub open: bool,
    /// Set once it's actually fullscreen on an external monitor; `None` while it's an ordinary
    /// window the operator hasn't placed yet, or there's only one display.
    pub monitor_label: Option<String>,
}

const CLOSED: PresentStatus = PresentStatus { open: false, monitor_label: None };

fn status_of(app: &AppHandle) -> PresentStatus {
    let Some(w) = app.get_webview_window(LABEL) else { return CLOSED };
    let monitor_label = w
        .is_fullscreen()
        .unwrap_or(false)
        .then(|| w.current_monitor().ok().flatten().and_then(|m| m.name().cloned()))
        .flatten();
    PresentStatus { open: true, monitor_label }
}

/// Default size for the presentation window when there's no second monitor to fullscreen it on,
/// so the operator has an ordinary window to place (or fullscreen themselves) rather than nothing.
const DEFAULT_SIZE: (f64, f64) = (960.0, 540.0);

fn ensure_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.show();
        return Some(w);
    }
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("Presentation")
        .inner_size(DEFAULT_SIZE.0, DEFAULT_SIZE.1)
        .build();
    let win = built.ok()?;
    let closed_app = app.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::CloseRequested { .. } = e {
            let _ = closed_app.emit_to(MAIN, "present://closed", ());
        }
    });
    Some(win)
}

/// Positions and fullscreens the presentation window on `mon`.
fn place_fullscreen(win: &tauri::WebviewWindow, mon: MonitorInfo) {
    let (x, y) = mon.position;
    let (w, h) = mon.size;
    let _ = win.set_fullscreen(false); // un-fullscreen first so re-homing across monitors works
    let _ = win.set_decorations(false);
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = win.set_size(tauri::PhysicalSize::new(w, h));
    let _ = win.set_fullscreen(true);
}

/// Releases the presentation window back to an ordinary, operator-placeable window.
fn release_to_windowed(win: &tauri::WebviewWindow) {
    let _ = win.set_fullscreen(false);
    let _ = win.set_decorations(true);
}

/// Opens (creating if needed) the presentation window: fullscreen on an external monitor if one is
/// connected, or left as an ordinary window otherwise — the main window is never taken over.
/// Idempotent, so it doubles as "redetect the display" when called again (e.g. after a monitor is
/// plugged in or removed mid-service). Every monitor/geometry call degrades gracefully rather than
/// panicking — an unplugged display must never crash the app.
#[tauri::command]
pub fn present_open(app: AppHandle) -> PresentStatus {
    let Some(win) = ensure_window(&app) else { return CLOSED };
    let monitors: Vec<MonitorInfo> = app.available_monitors().ok().unwrap_or_default().iter().map(MonitorInfo::from).collect();
    let primary = app.primary_monitor().ok().flatten().map(|m| MonitorInfo::from(&m));

    match choose_external(&monitors, primary.as_ref()) {
        Some(mon) => place_fullscreen(&win, mon),
        None => release_to_windowed(&win),
    }
    status_of(&app)
}

/// Stops presenting: closes the presentation window if there is one.
#[tauri::command]
pub fn present_close(app: AppHandle) -> PresentStatus {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
    CLOSED
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
