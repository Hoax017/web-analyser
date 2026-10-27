//! Extraction of candidate values from responses (data producers) and from
//! requests (data consumers).

use serde_json::Value;

use super::ExchangeInput;
use crate::models::{DataLocation, HttpHeader};

/// Hard cap of leaves walked per JSON document (protects against huge payloads).
const MAX_JSON_LEAVES: usize = 2_000;
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct ExtractedValue {
    pub name: String,
    pub value: String,
    pub location: DataLocation,
}

/// Headers that never carry application data worth correlating.
const IGNORED_HEADERS: &[&str] = &[
    "accept", "accept-encoding", "accept-language", "accept-ranges", "age", "cache-control",
    "connection", "content-encoding", "content-length", "content-type", "date", "etag",
    "expires", "host", "if-modified-since", "if-none-match", "keep-alive", "last-modified",
    "origin", "pragma", "priority", "referer", "server", "strict-transport-security",
    "transfer-encoding", "user-agent", "vary", "via", "alt-svc", "content-security-policy",
    "report-to", "nel", "upgrade-insecure-requests", "x-content-type-options",
    "x-frame-options", "x-xss-protection", "access-control-allow-origin",
    "access-control-allow-headers", "access-control-allow-methods",
    "access-control-allow-credentials", "access-control-expose-headers",
    "access-control-max-age", "access-control-request-method",
    "access-control-request-headers", "permissions-policy", "cross-origin-opener-policy",
    "cross-origin-resource-policy", "cross-origin-embedder-policy", "referrer-policy",
];

fn is_ignored_header(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with(':')
        || lower.starts_with("sec-")
        || lower.starts_with("cf-")
        || IGNORED_HEADERS.contains(&lower.as_str())
}

fn walk_json(value: &Value, key: &str, out: &mut Vec<(String, String)>) {
    if out.len() >= MAX_JSON_LEAVES {
        return;
    }
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                walk_json(v, k, out);
            }
        }
        Value::Array(items) => {
            for v in items {
                walk_json(v, key, out);
            }
        }
        Value::String(s) => out.push((key.to_owned(), s.clone())),
        Value::Number(n) => out.push((key.to_owned(), n.to_string())),
        Value::Bool(_) | Value::Null => {}
    }
}

fn json_leaves(body: &str) -> Option<Vec<(String, String)>> {
    let trimmed = body.trim_start();
    if body.len() > MAX_JSON_BYTES || !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return None;
    }
    let parsed: Value = serde_json::from_str(body).ok()?;
    let mut out = Vec::new();
    walk_json(&parsed, "value", &mut out);
    Some(out)
}

fn header_value<'a>(headers: &'a [HttpHeader], name: &str) -> Option<&'a str> {
    headers
        .iter()
        .find(|h| h.name.eq_ignore_ascii_case(name))
        .map(|h| h.value.as_str())
}

fn cookie_pairs(raw: &str) -> impl Iterator<Item = (String, String)> + '_ {
    raw.split(';').filter_map(|pair| {
        let (k, v) = pair.trim().split_once('=')?;
        Some((k.trim().to_owned(), v.trim().to_owned()))
    })
}

/// Values produced by a response, i.e. potential sources of a data flow.
pub fn response_values(ex: &ExchangeInput) -> Vec<ExtractedValue> {
    let mut out = Vec::new();

    for h in &ex.response_headers {
        if h.name.eq_ignore_ascii_case("set-cookie") {
            // A Set-Cookie header may be folded with '\n' by the browser.
            for line in h.value.lines() {
                if let Some((name, value)) = line.split(';').next().and_then(|p| p.split_once('=')) {
                    out.push(ExtractedValue {
                        name: name.trim().to_owned(),
                        value: value.trim().to_owned(),
                        location: DataLocation::ResponseCookie,
                    });
                }
            }
        } else if !is_ignored_header(&h.name) {
            out.push(ExtractedValue {
                name: h.name.to_ascii_lowercase(),
                value: h.value.clone(),
                location: DataLocation::ResponseHeader,
            });
        }
    }

    if let Some(leaves) = ex.response_body.as_deref().and_then(json_leaves) {
        out.extend(leaves.into_iter().map(|(name, value)| ExtractedValue {
            name,
            value,
            location: DataLocation::ResponseBody,
        }));
    }
    out
}

fn strip_auth_scheme(value: &str) -> &str {
    match value.split_once(' ') {
        Some((scheme, rest))
            if ["bearer", "basic", "token", "jwt"].contains(&scheme.to_ascii_lowercase().as_str()) =>
        {
            rest.trim()
        }
        _ => value,
    }
}

/// Values consumed by a request, i.e. potential targets of a data flow.
pub fn request_values(ex: &ExchangeInput) -> Vec<ExtractedValue> {
    let mut out = Vec::new();

    for h in &ex.request_headers {
        let lower = h.name.to_ascii_lowercase();
        if lower == "cookie" {
            out.extend(cookie_pairs(&h.value).map(|(name, value)| ExtractedValue {
                name,
                value,
                location: DataLocation::RequestCookie,
            }));
        } else if lower == "authorization" {
            out.push(ExtractedValue {
                name: lower,
                value: strip_auth_scheme(&h.value).to_owned(),
                location: DataLocation::RequestHeader,
            });
        } else if !is_ignored_header(&lower) {
            out.push(ExtractedValue {
                name: lower,
                value: h.value.clone(),
                location: DataLocation::RequestHeader,
            });
        }
    }

    if let Ok(parsed) = url::Url::parse(&ex.url) {
        out.extend(parsed.query_pairs().map(|(k, v)| ExtractedValue {
            name: k.into_owned(),
            value: v.into_owned(),
            location: DataLocation::RequestQuery,
        }));
        if let Some(segments) = parsed.path_segments() {
            let segments: Vec<&str> = segments.collect();
            for (i, seg) in segments.iter().enumerate() {
                let name = if i > 0 { segments[i - 1].to_owned() } else { format!("path[{i}]") };
                out.push(ExtractedValue {
                    name,
                    value: (*seg).to_owned(),
                    location: DataLocation::RequestPath,
                });
            }
        }
    }

    out.extend(request_body_values(ex));
    out
}

/// Body fields of the request (JSON or form-urlencoded).
pub fn request_body_values(ex: &ExchangeInput) -> Vec<ExtractedValue> {
    let Some(body) = ex.request_body.as_deref() else {
        return Vec::new();
    };
    let content_type = header_value(&ex.request_headers, "content-type").unwrap_or_default();

    let pairs: Vec<(String, String)> = if let Some(leaves) = json_leaves(body) {
        leaves
    } else if content_type.contains("x-www-form-urlencoded") {
        url::form_urlencoded::parse(body.as_bytes())
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    } else {
        Vec::new()
    };

    pairs
        .into_iter()
        .map(|(name, value)| ExtractedValue {
            name,
            value,
            location: DataLocation::RequestBody,
        })
        .collect()
}
