mod commands;
mod db;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub bible: Mutex<Connection>,
    pub user: Mutex<Connection>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let bible_path = app
                .path()
                .resolve("resources/bible.db", tauri::path::BaseDirectory::Resource)?;
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            app.manage(AppState {
                bible: Mutex::new(db::open_bible(&bible_path)?),
                user: Mutex::new(db::open_user(&data_dir.join("user.db"))?),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_translations,
            commands::list_books,
            commands::get_chapter,
            commands::search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
