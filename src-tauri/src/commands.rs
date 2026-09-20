use crate::db::{self, Book, Result, SearchHit, Translation, Verse};
use crate::AppState;
use tauri::State;

const DEFAULT_SEARCH_LIMIT: u32 = 50;
const MAX_SEARCH_LIMIT: u32 = 500;

#[tauri::command]
pub fn list_translations(state: State<AppState>) -> Result<Vec<Translation>> {
    db::list_translations(&state.bible.lock().unwrap())
}

#[tauri::command]
pub fn list_books(state: State<AppState>) -> Result<Vec<Book>> {
    db::list_books(&state.bible.lock().unwrap())
}

#[tauri::command]
pub fn get_chapter(
    state: State<AppState>,
    translation: String,
    book: u32,
    chapter: u32,
) -> Result<Vec<Verse>> {
    db::get_chapter(&state.bible.lock().unwrap(), &translation, book, chapter)
}

#[tauri::command]
pub fn search(
    state: State<AppState>,
    query: String,
    translation: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>> {
    let limit = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_LIMIT);
    db::search(&state.bible.lock().unwrap(), &query, translation.as_deref(), limit)
}
