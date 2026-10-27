//! Unified error type. Every Tauri command returns `AppResult<T>`; errors are
//! serialized as `{ kind, message }` so the frontend can discriminate them.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Erreur base de données : {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Erreur de sérialisation : {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Erreur d'entrée/sortie : {0}")]
    Io(#[from] std::io::Error),

    #[error("Erreur Tauri : {0}")]
    Tauri(#[from] tauri::Error),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    InvalidInput(String),

    #[error("{0}")]
    Capture(String),

    #[error("Erreur interne : {0}")]
    Internal(String),
}

impl AppError {
    pub fn kind(&self) -> &'static str {
        match self {
            AppError::Database(_) => "database",
            AppError::Serialization(_) => "serialization",
            AppError::Io(_) => "io",
            AppError::Tauri(_) => "tauri",
            AppError::NotFound(_) => "notFound",
            AppError::InvalidInput(_) => "invalidInput",
            AppError::Capture(_) => "capture",
            AppError::Internal(_) => "internal",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;
