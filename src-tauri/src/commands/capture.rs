use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::capture::{browser, debug_profile_dir, CaptureState, CaptureStatus};
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

/// Starts a capture with the browser configured in the settings
/// (opening the user's Chrome first when needed).
#[tauri::command]
pub async fn start_capture(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: i64,
) -> AppResult<CaptureStatus> {
    if state.capture.status()?.state != CaptureState::Idle {
        return Err(AppError::Capture("Une session de capture est déjà active".into()));
    }
    let db = Arc::clone(&state.db);
    let manager = state.capture.clone();
    let profile = debug_profile_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (settings, project) = db.with_conn(|c| {
            let settings: browser::BrowserSettings = db::settings::get(c, db::settings::BROWSER)?;
            Ok((settings, db::projects::get(c, project_id)?))
        })?;
        let target = browser::resolve_target(&settings, project.start_url, &profile)?;
        manager.start(&app, db, project_id, target)
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn pause_capture(app: AppHandle, state: State<'_, AppState>) -> AppResult<CaptureStatus> {
    state.capture.pause(&app)
}

#[tauri::command]
pub async fn resume_capture(app: AppHandle, state: State<'_, AppState>) -> AppResult<CaptureStatus> {
    state.capture.resume(&app)
}

#[tauri::command]
pub async fn stop_capture(state: State<'_, AppState>) -> AppResult<()> {
    state.capture.stop()
}

#[tauri::command]
pub async fn get_capture_status(state: State<'_, AppState>) -> AppResult<CaptureStatus> {
    state.capture.status()
}
