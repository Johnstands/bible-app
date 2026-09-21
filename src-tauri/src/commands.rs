use crate::db::{self, Book, Result, SearchFilter, SearchResults, Translation, Verse};
use crate::user::{self, ChapterMarks, Library, Note};
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

// Notes, highlights and bookmarks. Verse references carry no translation, but the Library shows
// verse text, which comes from the KJV.
const LIBRARY_TRANSLATION: &str = "KJV";

#[tauri::command]
pub fn get_marks(state: State<AppState>, book: u32, chapter: u32) -> Result<ChapterMarks> {
    user::chapter_marks(&state.user.lock().unwrap(), book, chapter)
}

#[tauri::command]
pub fn set_highlight(
    state: State<AppState>,
    book: u32,
    chapter: u32,
    verses: Vec<u32>,
    color: Option<String>,
) -> Result<()> {
    user::set_highlight(&state.user.lock().unwrap(), book, chapter, &verses, color.as_deref())
}

#[tauri::command]
pub fn save_note(
    state: State<AppState>,
    book: u32,
    chapter: u32,
    verse: u32,
    verse_end: Option<u32>,
    body: String,
) -> Result<Option<Note>> {
    user::save_note(&state.user.lock().unwrap(), book, chapter, verse, verse_end, &body)
}

#[tauri::command]
pub fn delete_note(state: State<AppState>, id: i64) -> Result<()> {
    user::delete_note(&state.user.lock().unwrap(), id)
}

#[tauri::command]
pub fn toggle_bookmark(state: State<AppState>, book: u32, chapter: u32, verse: u32) -> Result<bool> {
    user::toggle_bookmark(&state.user.lock().unwrap(), book, chapter, verse)
}

#[tauri::command]
pub fn get_library(state: State<AppState>) -> Result<Library> {
    // Always lock the Bible DB before the user DB so two commands can't deadlock.
    let bible = state.bible.lock().unwrap();
    let user = state.user.lock().unwrap();
    let text_of = |book, chapter, verse, end| {
        db::verse_text(&bible, LIBRARY_TRANSLATION, book, chapter, verse, end).unwrap_or_default()
    };
    user::library(&user, &text_of)
}
