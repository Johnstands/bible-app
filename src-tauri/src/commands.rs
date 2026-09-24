use crate::db::{self, Book, ChapterSize, Result, SearchFilter, SearchResults, Translation, Verse};
use crate::plans::{self, StartedPlan};
use crate::user::{self, ChapterMarks, Library, Note};
use crate::strongs::{self, StrongsEntry, VerseTags};
use crate::cards;
use crate::crossrefs::{self, CrossRef};
use crate::playlists::{self, NewItem, Playlist};
use crate::decks;
use crate::AppState;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

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

/// The phrases of a chapter that carry Strong's numbers, for the reader's original-language words.
#[tauri::command]
pub fn get_word_tags(
    state: State<AppState>,
    translation: String,
    book: u32,
    chapter: u32,
) -> Result<Vec<VerseTags>> {
    strongs::get_word_tags(&state.bible.lock().unwrap(), &translation, book, chapter)
}

/// Every chapter with its verse count, which is what reading plans are balanced by.
#[tauri::command]
pub fn list_chapters(state: State<AppState>, translation: String) -> Result<Vec<ChapterSize>> {
    db::list_chapters(&state.bible.lock().unwrap(), &translation)
}

/// The reading plans the reader has started, with the days they have finished.
#[tauri::command]
pub fn get_plans(state: State<AppState>) -> Result<Vec<StartedPlan>> {
    plans::get_plans(&state.user.lock().unwrap())
}

#[tauri::command]
pub fn start_plan(state: State<AppState>, plan: String, started_on: String) -> Result<()> {
    plans::start_plan(&state.user.lock().unwrap(), &plan, &started_on)
}

/// Stops a plan and forgets its progress.
#[tauri::command]
pub fn stop_plan(state: State<AppState>, plan: String) -> Result<()> {
    plans::stop_plan(&state.user.lock().unwrap(), &plan)
}

/// Marks a day of a started plan done or not done.
#[tauri::command]
pub fn set_plan_day(state: State<AppState>, plan: String, day: u32, done: bool, done_on: String) -> Result<()> {
    plans::set_day(&state.user.lock().unwrap(), &plan, day, done, &done_on)
}

/// Saves a verse card (PNG bytes) into the Pictures folder and returns where it went.
#[tauri::command]
pub fn save_image(app: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> Result<String> {
    let base = app.path().picture_dir().or_else(|_| app.path().download_dir())?;
    let path = cards::save_png(&base.join(cards::FOLDER), &file_name, &bytes)?;
    Ok(path.to_string_lossy().into_owned())
}

/// Passages related to a verse, most useful first, each with its text.
#[tauri::command]
pub fn get_cross_refs(
    state: State<AppState>,
    translation: String,
    book: u32,
    chapter: u32,
    verse: u32,
) -> Result<Vec<CrossRef>> {
    crossrefs::get_cross_refs(&state.bible.lock().unwrap(), &translation, book, chapter, verse)
}

/// The dictionary entry for a Strong's number such as `H7225`, or null if there is none.
#[tauri::command]
pub fn get_strongs(state: State<AppState>, num: String) -> Result<Option<StrongsEntry>> {
    strongs::get_strongs(&state.bible.lock().unwrap(), &num)
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

// Presentation mode's saved playlists: an ordered list of passages built ahead of a church service.

#[tauri::command]
pub fn list_playlists(state: State<AppState>) -> Result<Vec<Playlist>> {
    playlists::list_playlists(&state.user.lock().unwrap())
}

#[tauri::command]
pub fn create_playlist(state: State<AppState>, name: String) -> Result<i64> {
    playlists::create_playlist(&state.user.lock().unwrap(), &name)
}

#[tauri::command]
pub fn rename_playlist(state: State<AppState>, id: i64, name: String) -> Result<()> {
    playlists::rename_playlist(&state.user.lock().unwrap(), id, &name)
}

#[tauri::command]
pub fn delete_playlist(app: AppHandle, state: State<AppState>, id: i64) -> Result<()> {
    let unused = playlists::delete_playlist(&state.user.lock().unwrap(), id)?;
    decks::delete_files(&decks_root(&app)?, &unused);
    Ok(())
}

#[tauri::command]
pub fn save_playlist_items(app: AppHandle, state: State<AppState>, id: i64, items: Vec<NewItem>) -> Result<()> {
    let unused = playlists::save_playlist_items(&state.user.lock().unwrap(), id, &items)?;
    decks::delete_files(&decks_root(&app)?, &unused);
    Ok(())
}

/// Where slide decks' images are stored.
fn decks_root(app: &AppHandle) -> Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join(decks::DIR))
}

/// Adds images (in the order given) to the end of a playlist as one deck of slides. Async so copying
/// large images doesn't hold up the UI thread.
#[tauri::command]
pub async fn import_slides(app: AppHandle, state: State<'_, AppState>, playlist: i64, paths: Vec<PathBuf>) -> Result<()> {
    let root = decks_root(&app)?;
    decks::import_images(&state.user.lock().unwrap(), &root, playlist, &paths)?;
    Ok(())
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
