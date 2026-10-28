//! Unified error type. Every Tauri command returns `AppResult<T>`; errors are
//! serialized as `{ kind, message, code?, params? }` so the frontend can
//! discriminate them and translate the known ones (`code` mirrors
//! `ERROR_CODES` in src/i18n/types.ts; `message` is the English fallback).

use std::fmt;

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

/// User-facing message: English text, plus an optional code and parameters
/// the UI uses to render it in the selected language.
#[derive(Debug, Clone, Default)]
pub struct Msg {
    text: String,
    code: Option<&'static str>,
    params: Vec<(&'static str, String)>,
}

impl Msg {
    pub fn coded(code: &'static str, text: impl Into<String>) -> Self {
        Self { text: text.into(), code: Some(code), params: Vec::new() }
    }

    pub fn param(mut self, name: &'static str, value: impl ToString) -> Self {
        self.params.push((name, value.to_string()));
        self
    }
}

impl fmt::Display for Msg {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.text)
    }
}

impl From<String> for Msg {
    fn from(text: String) -> Self {
        Self { text, ..Self::default() }
    }
}

impl From<&str> for Msg {
    fn from(text: &str) -> Self {
        text.to_owned().into()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("{0}")]
    NotFound(Msg),

    #[error("{0}")]
    InvalidInput(Msg),

    #[error("{0}")]
    Capture(Msg),

    #[error("Internal error: {0}")]
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

    fn msg(&self) -> Option<&Msg> {
        match self {
            AppError::NotFound(m) | AppError::InvalidInput(m) | AppError::Capture(m) => Some(m),
            _ => None,
        }
    }
}

struct Params<'a>(&'a [(&'static str, String)]);

impl Serialize for Params<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_map(self.0.iter().map(|(k, v)| (*k, v)))
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let coded = self.msg().and_then(|m| m.code.map(|code| (code, &m.params)));
        let mut state = serializer.serialize_struct("AppError", if coded.is_some() { 4 } else { 2 })?;
        state.serialize_field("kind", self.kind())?;
        state.serialize_field("message", &self.to_string())?;
        if let Some((code, params)) = coded {
            state.serialize_field("code", code)?;
            state.serialize_field("params", &Params(params))?;
        }
        state.end()
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_code_and_params() {
        let err = AppError::Capture(Msg::coded("nodeNotFound", "Node.js not found").param("node", "node"));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["kind"], "capture");
        assert_eq!(json["message"], "Node.js not found");
        assert_eq!(json["code"], "nodeNotFound");
        assert_eq!(json["params"]["node"], "node");
    }

    #[test]
    fn plain_errors_have_no_code() {
        let json = serde_json::to_value(AppError::InvalidInput("bad".into())).unwrap();
        assert!(json.get("code").is_none());
    }
}
