use crate::db::{self, Book, Result, SearchFilter, SearchResults, Translation, Verse};
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
    testament: Option<String>,
    book: Option<u32>,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<SearchResults> {
    let limit = limit.unwrap_or(DEFAULT_SEARCH_LIMIT).min(MAX_SEARCH_LIMIT);
    let filter = SearchFilter {
        translation: translation.as_deref(),
        testament: testament.as_deref(),
        book,
    };
    db::search(&state.bible.lock().unwrap(), &query, &filter, limit, offset.unwrap_or(0))
}
