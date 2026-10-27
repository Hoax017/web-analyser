//! SQLite access layer. A single connection guarded by a mutex is shared by
//! commands (run on blocking threads) and the capture reader thread.

pub mod filters;
pub mod graph;
pub mod links;
mod migrations;
pub mod projects;
pub mod requests;
pub mod settings;

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;

use crate::error::{AppError, AppResult};

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        migrations::run(&mut conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn with_conn<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| AppError::Internal("verrou base de données empoisonné".into()))?;
        f(&mut guard)
    }
}

/// Runs a DB closure on a blocking thread so commands never stall the IPC loop.
pub async fn run_blocking<T, F>(db: &Arc<Database>, f: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Connection) -> AppResult<T> + Send + 'static,
{
    let db = Arc::clone(db);
    tauri::async_runtime::spawn_blocking(move || db.with_conn(f))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?
}
