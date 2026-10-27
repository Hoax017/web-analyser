use std::sync::Arc;

use crate::capture::CaptureManager;
use crate::db::Database;

pub struct AppState {
    pub db: Arc<Database>,
    pub capture: CaptureManager,
}
