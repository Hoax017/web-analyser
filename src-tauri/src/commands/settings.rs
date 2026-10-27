use tauri::{AppHandle, State};

use crate::capture::browser::{self, BrowserDefaults, BrowserSettings};
use crate::capture::debug_profile_dir;
use crate::db::{self, run_blocking};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[tauri::command]
pub async fn get_browser_settings(state: State<'_, AppState>) -> AppResult<BrowserSettings> {
    run_blocking(&state.db, |c| db::settings::get(c, db::settings::BROWSER)).await
}

#[tauri::command]
pub async fn set_browser_settings(
    state: State<'_, AppState>,
    settings: BrowserSettings,
) -> AppResult<BrowserSettings> {
    let settings = settings.normalized()?;
    run_blocking(&state.db, move |c| {
        db::settings::set(c, db::settings::BROWSER, &settings)?;
        Ok(settings)
    })
    .await
}

#[tauri::command]
pub async fn get_browser_defaults(app: AppHandle) -> AppResult<BrowserDefaults> {
    let profile = debug_profile_dir(&app)?;
    blocking(move || Ok(browser::defaults(&profile))).await
}

/// Returns the version reported by the Chrome listening on `endpoint`.
#[tauri::command]
pub async fn test_browser_connection(endpoint: String) -> AppResult<String> {
    blocking(move || browser::probe(endpoint.trim())).await
}

/// Opens the user's Chrome in debugging mode (e.g. to log in before capturing).
#[tauri::command]
pub async fn open_debug_browser(app: AppHandle, settings: BrowserSettings) -> AppResult<String> {
    let settings = settings.normalized()?;
    let profile = debug_profile_dir(&app)?;
    blocking(move || browser::launch_debug_chrome(&settings, &profile)).await
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
