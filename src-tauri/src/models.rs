//! Domain models shared with the frontend (serialized in camelCase).
//! Keep in sync with `src/types/domain.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryParam {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub start_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub request_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProject {
    pub name: String,
    pub start_url: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BodyEncoding {
    Utf8,
    Base64,
    None,
}

impl BodyEncoding {
    pub fn as_str(self) -> &'static str {
        match self {
            BodyEncoding::Utf8 => "utf8",
            BodyEncoding::Base64 => "base64",
            BodyEncoding::None => "none",
        }
    }

    pub fn parse(value: &str) -> Self {
        match value {
            "utf8" => BodyEncoding::Utf8,
            "base64" => BodyEncoding::Base64,
            _ => BodyEncoding::None,
        }
    }
}

/// Lightweight projection used by the virtualized list and the graph nodes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSummary {
    pub id: i64,
    pub project_id: i64,
    pub method: String,
    pub url: String,
    pub host: String,
    pub path: String,
    pub resource_type: String,
    pub status: Option<i64>,
    pub started_at: i64,
    pub duration_ms: Option<f64>,
    pub mime_type: Option<String>,
    pub failed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestDetail {
    #[serde(flatten)]
    pub summary: RequestSummary,
    pub status_text: Option<String>,
    pub request_headers: Vec<HttpHeader>,
    pub query_params: Vec<QueryParam>,
    pub request_body: Option<String>,
    pub response_headers: Vec<HttpHeader>,
    pub response_body: Option<String>,
    pub response_body_encoding: BodyEncoding,
    pub response_size: Option<i64>,
    pub failure_text: Option<String>,
}

/// One row of the request list: every occurrence of the same method + host + path,
/// represented by its latest occurrence.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestGroup {
    #[serde(flatten)]
    pub latest: RequestSummary,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestPage {
    pub items: Vec<RequestGroup>,
    pub total: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum LinkOrigin {
    Auto,
    Manual,
}

impl LinkOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            LinkOrigin::Auto => "auto",
            LinkOrigin::Manual => "manual",
        }
    }

    pub fn parse(value: &str) -> Self {
        if value == "manual" {
            LinkOrigin::Manual
        } else {
            LinkOrigin::Auto
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ValueType {
    Jwt,
    Uuid,
    Email,
    Url,
    Number,
    Boolean,
    String,
}

/// Where a value was found (source side) or injected (target side).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum DataLocation {
    ResponseBody,
    ResponseHeader,
    ResponseCookie,
    RequestBody,
    RequestHeader,
    RequestCookie,
    RequestQuery,
    RequestPath,
    UserInput,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LinkVariable {
    /// Name on the source side (e.g. `token` in the `/login` response).
    pub name: String,
    /// Name on the target side (e.g. `authorization` header of `/me`).
    pub target_name: String,
    pub value_type: ValueType,
    pub source_location: DataLocation,
    pub target_location: DataLocation,
    /// Truncated sample of the transferred value.
    pub sample: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub id: i64,
    pub project_id: i64,
    /// `None` means the value originates from the user (virtual "user" node).
    pub source_request_id: Option<i64>,
    pub target_request_id: i64,
    pub origin: LinkOrigin,
    pub variables: Vec<LinkVariable>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewLink {
    pub project_id: i64,
    pub source_request_id: Option<i64>,
    pub target_request_id: i64,
    pub variables: Vec<LinkVariable>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodePosition {
    /// `user` or `req:<id>`.
    pub node_key: String,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

/// A fixed node position sent by the front (bulk save after an automatic layout).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodePlacement {
    pub node_key: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphData {
    pub requests: Vec<RequestSummary>,
    pub links: Vec<Link>,
    pub positions: Vec<GraphNodePosition>,
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_millis()).unwrap_or(i64::MAX))
        .unwrap_or(0)
}
