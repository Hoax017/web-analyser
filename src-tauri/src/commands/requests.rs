use tauri::State;

use crate::db::{self, run_blocking};
use crate::error::AppResult;
use crate::models::{RequestDetail, RequestPage, RequestSummary};
use crate::state::AppState;

#[tauri::command]
pub async fn list_requests(
    state: State<'_, AppState>,
    project_id: i64,
    query: Option<String>,
    offset: i64,
    limit: i64,
) -> AppResult<RequestPage> {
    run_blocking(&state.db, move |c| {
        db::requests::list(c, project_id, query.as_deref(), offset, limit)
    })
    .await
}

#[tauri::command]
pub async fn get_request(state: State<'_, AppState>, request_id: i64) -> AppResult<RequestDetail> {
    run_blocking(&state.db, move |c| db::requests::get_detail(c, request_id)).await
}

#[tauri::command]
pub async fn list_occurrences(state: State<'_, AppState>, request_id: i64) -> AppResult<Vec<RequestSummary>> {
    run_blocking(&state.db, move |c| db::requests::occurrences(c, request_id)).await
}

/// Which of `request_ids` match the global search (used to filter the graph).
#[tauri::command]
pub async fn match_requests(
    state: State<'_, AppState>,
    project_id: i64,
    query: String,
    request_ids: Vec<i64>,
) -> AppResult<Vec<i64>> {
    run_blocking(&state.db, move |c| db::requests::matching_ids(c, project_id, &query, &request_ids)).await
}
