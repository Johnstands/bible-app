mod cards;
mod commands;
mod crossrefs;
mod db;
mod decks;
mod plans;
mod present;
mod playlists;
mod strongs;
mod syslibs;
mod user;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub bible: Mutex<Connection>,
    pub user: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    syslibs::prefer_system_libs();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // Reopen at the size, position and maximised state the window was closed with. The presentation
        // window is excluded: its position and fullscreen state are worked out fresh every time from the
        // connected monitors (see `present.rs`), and letting this plugin restore stale geometry onto it
        // would fight that placement.
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&[present::LABEL]).build())
        // Checks GitHub Releases for a newer signed build; the app decides when to ask (see src/updater.ts).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // The file picker for adding slides to a playlist.
        .plugin(tauri_plugin_dialog::init())
        // Slide images for presentation-mode playlists, loadable by both windows (see decks.rs).
        .register_uri_scheme_protocol(decks::SCHEME, |ctx, request| {
            let root = ctx.app_handle().path().app_data_dir().ok().map(|d| d.join(decks::DIR));
            decks::serve(root, request.uri().path())
        })
        .setup(|app| {
            let bible_path = app
                .path()
                .resolve("resources/bible.db", tauri::path::BaseDirectory::Resource)?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState {
                bible: Mutex::new(db::open_bible(&bible_path)?),
                user: Mutex::new(user::open(&data_dir.join("user.db"))?),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_translations,
            commands::list_books,
            commands::get_chapter,
            commands::search,
            commands::get_word_tags,
            commands::get_strongs,
            commands::get_cross_refs,
            commands::save_image,
            commands::list_chapters,
            commands::get_plans,
            commands::start_plan,
            commands::stop_plan,
            commands::set_plan_day,
            commands::get_marks,
            commands::set_highlight,
            commands::save_note,
            commands::delete_note,
            commands::toggle_bookmark,
            commands::get_library,
            commands::list_playlists,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::save_playlist_items,
            commands::import_slides,
            present::present_open,
            present::present_close,
            present::present_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
