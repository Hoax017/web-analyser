use tauri::State;

use crate::db::{self, run_blocking};
use crate::error::AppResult;
use crate::models::{NewProject, Project};
use crate::state::AppState;

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> AppResult<Vec<Project>> {
    run_blocking(&state.db, |c| db::projects::list(c)).await
}

#[tauri::command]
pub async fn get_project(state: State<'_, AppState>, project_id: i64) -> AppResult<Project> {
    run_blocking(&state.db, move |c| db::projects::get(c, project_id)).await
}

#[tauri::command]
pub async fn create_project(state: State<'_, AppState>, input: NewProject) -> AppResult<Project> {
    run_blocking(&state.db, move |c| db::projects::create(c, input)).await
}

#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, project_id: i64) -> AppResult<()> {
    if state.capture.active_project()? == Some(project_id) {
        state.capture.stop()?;
    }
    run_blocking(&state.db, move |c| db::projects::delete(c, project_id)).await
}

#[tauri::command]
pub async fn get_hidden_patterns(state: State<'_, AppState>, project_id: i64) -> AppResult<Vec<String>> {
    run_blocking(&state.db, move |c| db::filters::list(c, project_id)).await
}

#[tauri::command]
pub async fn set_hidden_patterns(
    state: State<'_, AppState>,
    project_id: i64,
    patterns: Vec<String>,
) -> AppResult<Vec<String>> {
    run_blocking(&state.db, move |c| {
        db::projects::get(c, project_id)?;
        db::filters::replace(c, project_id, &patterns)
    })
    .await
}
