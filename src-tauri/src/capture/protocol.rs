//! Wire protocol between the Rust backend and the Node capture agent.
//! Agent -> Rust: NDJSON on stdout. Rust -> Agent: NDJSON on stdin.
//! Keep in sync with `capture-agent/src/protocol.ts`.

use serde::{Deserialize, Serialize};

use crate::models::{BodyEncoding, HttpHeader};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedExchange {
    pub method: String,
    pub url: String,
    pub resource_type: String,
    pub started_at: i64,
    pub duration_ms: Option<f64>,
    pub request_headers: Vec<HttpHeader>,
    pub request_body: Option<String>,
    pub status: Option<i64>,
    pub status_text: Option<String>,
    pub mime_type: Option<String>,
    pub response_headers: Vec<HttpHeader>,
    pub response_body: Option<String>,
    pub response_body_encoding: BodyEncoding,
    pub response_size: Option<i64>,
    pub failure_text: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AgentEvent {
    Ready { browser_version: String },
    Exchange { data: Box<CapturedExchange> },
    Log { level: String, message: String },
    Error { message: String },
    Closed,
}

/// How the agent should obtain a browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum CaptureTarget {
    /// Launch the locally installed Google Chrome with a persistent profile.
    Launch { start_url: Option<String> },
    /// Attach to an already running Chrome (`--remote-debugging-port`).
    Cdp { endpoint: String, start_url: Option<String> },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfig {
    pub target: CaptureTarget,
    pub user_data_dir: String,
    pub capture_static_assets: bool,
    pub max_body_bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentCommand {
    Start { config: AgentConfig },
    Pause,
    Resume,
    Stop,
}
