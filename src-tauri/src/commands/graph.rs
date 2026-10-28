use tauri::State;

use crate::correlation::CorrelationEngine;
use crate::db::{self, run_blocking};
use crate::error::{AppError, AppResult, Msg};
use crate::models::{GraphData, Link, LinkVariable, NewLink, NodePlacement};
use crate::state::AppState;

#[tauri::command]
pub async fn get_graph(state: State<'_, AppState>, project_id: i64) -> AppResult<GraphData> {
    run_blocking(&state.db, move |c| db::graph::get(c, project_id)).await
}

#[tauri::command]
pub async fn create_link(state: State<'_, AppState>, input: NewLink) -> AppResult<Link> {
    run_blocking(&state.db, move |c| db::links::create_manual(c, &input)).await
}

#[tauri::command]
pub async fn update_link(
    state: State<'_, AppState>,
    link_id: i64,
    variables: Vec<LinkVariable>,
) -> AppResult<Link> {
    run_blocking(&state.db, move |c| db::links::update_variables(c, link_id, &variables)).await
}

#[tauri::command]
pub async fn delete_link(state: State<'_, AppState>, link_id: i64) -> AppResult<()> {
    run_blocking(&state.db, move |c| db::links::delete(c, link_id)).await
}

/// Drops automatic links and re-runs the correlation engine on the whole project.
/// Manual (or manually edited) links are preserved.
#[tauri::command]
pub async fn recompute_links(state: State<'_, AppState>, project_id: i64) -> AppResult<GraphData> {
    if state.capture.active_project()? == Some(project_id) {
        return Err(AppError::Capture(Msg::coded(
            "stopCaptureFirst",
            "Stop the capture before re-running the link analysis",
        )));
    }
    run_blocking(&state.db, move |c| {
        let mut engine = CorrelationEngine::new();
        let mut detected = Vec::new();
        db::requests::for_each_exchange(c, project_id, |ex| detected.extend(engine.process(&ex)))?;
        db::links::delete_auto(c, project_id)?;
        db::links::insert_detected(c, project_id, &detected)?;
        db::graph::get(c, project_id)
    })
    .await
}

#[tauri::command]
pub async fn save_node_position(
    state: State<'_, AppState>,
    project_id: i64,
    node_key: String,
    x: f64,
    y: f64,
) -> AppResult<()> {
    if !x.is_finite() || !y.is_finite() {
        return Err(AppError::InvalidInput(Msg::coded("invalidPosition", "Invalid position")));
    }
    run_blocking(&state.db, move |c| db::graph::save_position(c, project_id, &node_key, x, y)).await
}

#[tauri::command]
pub async fn save_node_positions(
    state: State<'_, AppState>,
    project_id: i64,
    placements: Vec<NodePlacement>,
) -> AppResult<()> {
    if placements.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return Err(AppError::InvalidInput(Msg::coded("invalidPosition", "Invalid position")));
    }
    run_blocking(&state.db, move |c| db::graph::save_positions(c, project_id, &placements)).await
}

#[tauri::command]
pub async fn pin_request(state: State<'_, AppState>, project_id: i64, request_id: i64) -> AppResult<()> {
    run_blocking(&state.db, move |c| {
        if !db::requests::exists_in_project(c, project_id, request_id)? {
            return Err(AppError::NotFound(
                Msg::coded("requestNotFound", format!("Request {request_id} not found")).param("id", request_id),
            ));
        }
        db::graph::pin(c, project_id, &db::graph::request_node_key(request_id))
    })
    .await
}

#[tauri::command]
pub async fn unpin_request(state: State<'_, AppState>, project_id: i64, request_id: i64) -> AppResult<()> {
    run_blocking(&state.db, move |c| {
        db::graph::unpin(c, project_id, &db::graph::request_node_key(request_id))
    })
    .await
}
