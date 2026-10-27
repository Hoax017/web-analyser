//! Automatic data-flow detection between requests.
//!
//! Principle: every significant value *produced* by a response (JSON field,
//! header, cookie) is indexed. When a later request *consumes* the exact same
//! value (header, cookie, query, path segment, body field), a link
//! `producer -> consumer` is created. Body fields of mutating requests that
//! match no producer are attributed to the virtual "user" node.

mod extract;
pub mod infer;

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::models::{DataLocation, HttpHeader, LinkVariable, ValueType};

const SAMPLE_MAX_CHARS: usize = 120;
const MAX_USER_VARIABLES: usize = 15;

/// Minimal view of an exchange needed by the engine.
#[derive(Debug, Clone)]
pub struct ExchangeInput {
    pub id: i64,
    pub method: String,
    pub url: String,
    pub request_headers: Vec<HttpHeader>,
    pub request_body: Option<String>,
    pub response_headers: Vec<HttpHeader>,
    /// Only UTF-8 bodies are analysed.
    pub response_body: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DetectedLink {
    /// `None` => user input.
    pub source_request_id: Option<i64>,
    pub target_request_id: i64,
    pub variables: Vec<LinkVariable>,
}

#[derive(Debug, Clone)]
struct Producer {
    request_id: i64,
    name: String,
    location: DataLocation,
    value_type: ValueType,
}

#[derive(Default)]
pub struct CorrelationEngine {
    /// value -> most recent producer of that value.
    index: HashMap<String, Producer>,
}

fn sample(value: &str) -> Option<String> {
    let mut s: String = value.chars().take(SAMPLE_MAX_CHARS).collect();
    if value.chars().count() > SAMPLE_MAX_CHARS {
        s.push('…');
    }
    Some(s)
}

impl CorrelationEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Processes exchanges in capture order. Returns links whose target is `ex`.
    pub fn process(&mut self, ex: &ExchangeInput) -> Vec<DetectedLink> {
        let mut by_source: BTreeMap<Option<i64>, Vec<LinkVariable>> = BTreeMap::new();
        let mut seen: HashSet<(Option<i64>, String, DataLocation)> = HashSet::new();
        let mut consumed: HashSet<String> = HashSet::new();

        for input in extract::request_values(ex) {
            if !infer::is_significant(&input.value) {
                continue;
            }
            let Some(producer) = self.index.get(input.value.trim()) else {
                continue;
            };
            if producer.request_id == ex.id {
                continue;
            }
            consumed.insert(input.value.clone());
            let source = Some(producer.request_id);
            if seen.insert((source, input.name.clone(), input.location)) {
                by_source.entry(source).or_default().push(LinkVariable {
                    name: producer.name.clone(),
                    target_name: input.name,
                    value_type: producer.value_type,
                    source_location: producer.location,
                    target_location: input.location,
                    sample: sample(&input.value),
                });
            }
        }

        if matches!(ex.method.to_ascii_uppercase().as_str(), "POST" | "PUT" | "PATCH") {
            let user_vars: Vec<LinkVariable> = extract::request_body_values(ex)
                .into_iter()
                .filter(|v| !v.value.is_empty() && v.value.len() <= 512 && !consumed.contains(&v.value))
                .take(MAX_USER_VARIABLES)
                .map(|v| LinkVariable {
                    value_type: infer::infer(&v.value),
                    target_name: v.name.clone(),
                    name: v.name,
                    source_location: DataLocation::UserInput,
                    target_location: DataLocation::RequestBody,
                    sample: sample(&v.value),
                })
                .collect();
            if !user_vars.is_empty() {
                by_source.insert(None, user_vars);
            }
        }

        // Index produced values after matching, so a request never links to itself.
        for out in extract::response_values(ex) {
            let value = out.value.trim();
            if infer::is_significant(value) {
                self.index.insert(
                    value.to_owned(),
                    Producer {
                        request_id: ex.id,
                        value_type: infer::infer(value),
                        name: out.name,
                        location: out.location,
                    },
                );
            }
        }

        by_source
            .into_iter()
            .map(|(source_request_id, variables)| DetectedLink {
                source_request_id,
                target_request_id: ex.id,
                variables,
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header(name: &str, value: &str) -> HttpHeader {
        HttpHeader { name: name.into(), value: value.into() }
    }

    const JWT: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";

    #[test]
    fn links_login_token_to_me() {
        let mut engine = CorrelationEngine::new();
        let login = ExchangeInput {
            id: 1,
            method: "POST".into(),
            url: "https://api.test/login".into(),
            request_headers: vec![header("content-type", "application/json")],
            request_body: Some(r#"{"login":"john","password":"s3cret!"}"#.into()),
            response_headers: vec![],
            response_body: Some(format!(r#"{{"token":"{JWT}"}}"#)),
        };
        let me = ExchangeInput {
            id: 2,
            method: "GET".into(),
            url: "https://api.test/me".into(),
            request_headers: vec![header("Authorization", &format!("Bearer {JWT}"))],
            request_body: None,
            response_headers: vec![],
            response_body: None,
        };

        let first = engine.process(&login);
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].source_request_id, None);
        assert_eq!(first[0].variables.len(), 2);

        let second = engine.process(&me);
        assert_eq!(second.len(), 1);
        let link = &second[0];
        assert_eq!(link.source_request_id, Some(1));
        assert_eq!(link.variables[0].name, "token");
        assert_eq!(link.variables[0].target_name, "authorization");
        assert_eq!(link.variables[0].value_type, ValueType::Jwt);
    }
}
