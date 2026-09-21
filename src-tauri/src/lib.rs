mod cards;
mod commands;
mod crossrefs;
mod db;
mod plans;
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
        // Reopen at the size, position and maximised state the window was closed with.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Checks GitHub Releases for a newer signed build; the app decides when to ask (see src/updater.ts).
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
