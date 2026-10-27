mod capture;
mod commands;
mod correlation;
mod db;
mod error;
mod models;
mod state;

use std::sync::Arc;

use tauri::Manager;

use capture::CaptureManager;
use db::Database;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let db_path = app.path().app_data_dir()?.join("web-analyser.db");
            let db = Database::open(&db_path).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
            app.manage(AppState {
                db: Arc::new(db),
                capture: CaptureManager::default(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::projects::list_projects,
            commands::projects::get_project,
            commands::projects::create_project,
            commands::projects::delete_project,
            commands::projects::get_hidden_patterns,
            commands::projects::set_hidden_patterns,
            commands::requests::list_requests,
            commands::requests::get_request,
            commands::requests::list_occurrences,
            commands::requests::match_requests,
            commands::graph::get_graph,
            commands::graph::create_link,
            commands::graph::update_link,
            commands::graph::delete_link,
            commands::graph::recompute_links,
            commands::graph::save_node_position,
            commands::graph::save_node_positions,
            commands::graph::pin_request,
            commands::graph::unpin_request,
            commands::capture::start_capture,
            commands::capture::pause_capture,
            commands::capture::resume_capture,
            commands::capture::stop_capture,
            commands::capture::get_capture_status,
            commands::settings::get_browser_settings,
            commands::settings::set_browser_settings,
            commands::settings::get_browser_defaults,
            commands::settings::test_browser_connection,
            commands::settings::open_debug_browser,
        ])
        .build(tauri::generate_context!())
        .expect("erreur lors de l'initialisation de Tauri");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = handle.try_state::<AppState>() {
                state.capture.shutdown();
            }
        }
    });
}
