//! Per-project display filters: requests matching a hidden pattern stay in the
//! database (and still feed the correlation engine) but are not displayed.

use std::collections::HashSet;

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};

const MAX_PATTERNS: usize = 100;
const MAX_PATTERN_LEN: usize = 500;

/// SQL predicate (on alias `r`) that is true when the request is visible.
/// Patterns use SQLite GLOB syntax and are tested against the path and the full URL,
/// so `/_nuxt/*.js` and `*://cdn.example.com/*` both work.
pub(crate) const VISIBLE: &str = "NOT EXISTS (
    SELECT 1 FROM hidden_patterns h
    WHERE h.project_id = r.project_id AND (r.path GLOB h.pattern OR r.url GLOB h.pattern))";

pub fn list(conn: &Connection, project_id: i64) -> AppResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT pattern FROM hidden_patterns WHERE project_id = ?1 ORDER BY pattern")?;
    let rows = stmt.query_map([project_id], |row| row.get(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// Replaces the whole pattern set of a project.
pub fn replace(conn: &mut Connection, project_id: i64, patterns: &[String]) -> AppResult<Vec<String>> {
    let mut cleaned: Vec<&str> = patterns.iter().map(|p| p.trim()).filter(|p| !p.is_empty()).collect();
    cleaned.sort_unstable();
    cleaned.dedup();
    if cleaned.len() > MAX_PATTERNS {
        return Err(AppError::InvalidInput(format!("{MAX_PATTERNS} motifs maximum")));
    }
    if let Some(p) = cleaned.iter().find(|p| p.len() > MAX_PATTERN_LEN) {
        return Err(AppError::InvalidInput(format!("Motif trop long : {p}")));
    }

    let tx = conn.transaction()?;
    tx.execute("DELETE FROM hidden_patterns WHERE project_id = ?1", [project_id])?;
    {
        let mut insert =
            tx.prepare("INSERT INTO hidden_patterns (project_id, pattern) VALUES (?1, ?2)")?;
        for pattern in &cleaned {
            insert.execute(params![project_id, pattern])?;
        }
    }
    tx.commit()?;
    list(conn, project_id)
}

/// Returns the subset of `ids` that are visible.
pub fn visible_ids(conn: &Connection, ids: &[i64]) -> AppResult<HashSet<i64>> {
    let mut stmt = conn.prepare(&format!("SELECT 1 FROM requests r WHERE r.id = ?1 AND {VISIBLE}"))?;
    let mut out = HashSet::with_capacity(ids.len());
    for &id in ids {
        if stmt.exists([id])? {
            out.insert(id);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewProject;

    #[test]
    fn hides_matching_paths() {
        let mut conn = Connection::open_in_memory().unwrap();
        super::super::migrations::run(&mut conn).unwrap();
        let project = crate::db::projects::create(
            &conn,
            NewProject { name: "t".into(), start_url: None },
        )
        .unwrap();
        for (i, url) in ["https://a.org/_nuxt/ClV-qfqE.js", "https://a.org/api/me"].iter().enumerate() {
            conn.execute(
                "INSERT INTO requests (id, project_id, method, url, host, path, resource_type, started_at,
                    request_headers, response_headers, response_body_encoding)
                 VALUES (?1, ?2, 'GET', ?3, 'a.org', ?4, 'script', 0, '[]', '[]', 'none')",
                params![i as i64 + 1, project.id, url, url.trim_start_matches("https://a.org")],
            )
            .unwrap();
        }
        replace(&mut conn, project.id, &[" /_nuxt/*.js ".into(), String::new()]).unwrap();
        assert_eq!(list(&conn, project.id).unwrap(), vec!["/_nuxt/*.js".to_owned()]);
        assert_eq!(visible_ids(&conn, &[1, 2]).unwrap(), HashSet::from([2]));
    }
}
