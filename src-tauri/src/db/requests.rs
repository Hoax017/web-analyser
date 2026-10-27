use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::capture::protocol::CapturedExchange;
use crate::correlation::ExchangeInput;
use crate::error::{AppError, AppResult};
use crate::models::{
    BodyEncoding, HttpHeader, QueryParam, RequestDetail, RequestGroup, RequestPage, RequestSummary,
};

/// Upper bound of text indexed by FTS per side (keeps the index compact).
const FTS_MAX_BYTES: usize = 512 * 1024;
const MAX_PAGE_SIZE: i64 = 500;
/// Upper bound of occurrences returned for one grouped request (most recent kept).
const MAX_OCCURRENCES: i64 = 1000;

pub(crate) const SUMMARY_COLUMNS: &str = "r.id, r.project_id, r.method, r.url, r.host, r.path, \
    r.resource_type, r.status, r.started_at, r.duration_ms, r.mime_type, r.failure_text IS NOT NULL";

pub(crate) fn map_summary(row: &Row<'_>) -> rusqlite::Result<RequestSummary> {
    Ok(RequestSummary {
        id: row.get(0)?,
        project_id: row.get(1)?,
        method: row.get(2)?,
        url: row.get(3)?,
        host: row.get(4)?,
        path: row.get(5)?,
        resource_type: row.get(6)?,
        status: row.get(7)?,
        started_at: row.get(8)?,
        duration_ms: row.get(9)?,
        mime_type: row.get(10)?,
        failed: row.get(11)?,
    })
}

fn truncate_utf8(value: &str, max: usize) -> &str {
    if value.len() <= max {
        return value;
    }
    let mut end = max;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn headers_text(headers: &[HttpHeader]) -> String {
    headers
        .iter()
        .map(|h| format!("{}: {}", h.name, h.value))
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_headers(raw: &str) -> AppResult<Vec<HttpHeader>> {
    Ok(serde_json::from_str(raw)?)
}

pub fn insert_exchange(
    conn: &mut Connection,
    project_id: i64,
    ex: &CapturedExchange,
) -> AppResult<RequestSummary> {
    let (host, path) = match url::Url::parse(&ex.url) {
        Ok(u) => (u.host_str().unwrap_or_default().to_owned(), u.path().to_owned()),
        Err(_) => (String::new(), ex.url.clone()),
    };

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO requests (project_id, method, url, host, path, resource_type, started_at,
            duration_ms, status, status_text, mime_type, request_headers, request_body,
            response_headers, response_body, response_body_encoding, response_size, failure_text)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
        params![
            project_id,
            ex.method,
            ex.url,
            host,
            path,
            ex.resource_type,
            ex.started_at,
            ex.duration_ms,
            ex.status,
            ex.status_text,
            ex.mime_type,
            serde_json::to_string(&ex.request_headers)?,
            ex.request_body,
            serde_json::to_string(&ex.response_headers)?,
            ex.response_body,
            ex.response_body_encoding.as_str(),
            ex.response_size,
            ex.failure_text,
        ],
    )?;
    let id = tx.last_insert_rowid();

    let request_text = format!(
        "{}\n{}",
        headers_text(&ex.request_headers),
        ex.request_body.as_deref().unwrap_or_default()
    );
    let response_body_text = match ex.response_body_encoding {
        BodyEncoding::Utf8 => ex.response_body.as_deref().unwrap_or_default(),
        _ => "",
    };
    let response_text = format!("{}\n{}", headers_text(&ex.response_headers), response_body_text);
    tx.execute(
        "INSERT INTO requests_fts (rowid, url, request_text, response_text) VALUES (?1, ?2, ?3, ?4)",
        params![
            id,
            ex.url,
            truncate_utf8(&request_text, FTS_MAX_BYTES),
            truncate_utf8(&response_text, FTS_MAX_BYTES)
        ],
    )?;
    tx.execute(
        "UPDATE projects SET updated_at = ?2 WHERE id = ?1",
        params![project_id, crate::models::now_ms()],
    )?;
    tx.commit()?;

    Ok(RequestSummary {
        id,
        project_id,
        method: ex.method.clone(),
        url: ex.url.clone(),
        host,
        path,
        resource_type: ex.resource_type.clone(),
        status: ex.status,
        started_at: ex.started_at,
        duration_ms: ex.duration_ms,
        mime_type: ex.mime_type.clone(),
        failed: ex.failure_text.is_some(),
    })
}

/// Escapes a user query into an FTS5 phrase (substring match via trigram).
fn fts_phrase(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
}

fn like_pattern(query: &str) -> String {
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

/// SQL fragment (bound to `?2`) restricting `r` to requests matching `query`.
/// Trigram FTS needs >= 3 chars; shorter queries fall back to URL LIKE.
fn search_filter(query: Option<&str>) -> (&'static str, Option<String>) {
    match query.map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) if q.chars().count() >= 3 => (
            "AND r.id IN (SELECT rowid FROM requests_fts WHERE requests_fts MATCH ?2)",
            Some(fts_phrase(q)),
        ),
        Some(q) => ("AND r.url LIKE ?2 ESCAPE '\\'", Some(like_pattern(q))),
        None => ("AND ?2 IS NULL", None),
    }
}

/// Subset of `ids` (e.g. the requests shown on the graph) matching the search query.
pub fn matching_ids(conn: &Connection, project_id: i64, query: &str, ids: &[i64]) -> AppResult<Vec<i64>> {
    let (filter, needle) = search_filter(Some(query));
    let mut stmt = conn.prepare(&format!(
        "SELECT r.id FROM requests r
         WHERE r.project_id = ?1 {filter} AND r.id IN (SELECT value FROM json_each(?3))"
    ))?;
    let ids_json = serde_json::to_string(ids)?;
    let rows = stmt
        .query_map(params![project_id, needle, ids_json], |row| row.get(0))?
        .collect::<Result<Vec<i64>, _>>()?;
    Ok(rows)
}

pub fn list(
    conn: &Connection,
    project_id: i64,
    query: Option<&str>,
    offset: i64,
    limit: i64,
) -> AppResult<RequestPage> {
    let limit = limit.clamp(1, MAX_PAGE_SIZE);
    let offset = offset.max(0);
    let (filter, needle) = search_filter(query);

    // Identical requests (method + host + path) are grouped; groups keep the
    // position of their first occurrence so pages stay stable during live capture.
    let visible = super::filters::VISIBLE;
    let grouped = format!(
        "SELECT MIN(r.id) AS first_id, MAX(r.id) AS last_id, COUNT(*) AS n
         FROM requests r WHERE r.project_id = ?1 {filter} AND {visible}
         GROUP BY r.method, r.host, r.path"
    );
    let total: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM ({grouped})"),
        params![project_id, needle],
        |row| row.get(0),
    )?;

    let mut stmt = conn.prepare(&format!(
        "WITH g AS ({grouped})
         SELECT {SUMMARY_COLUMNS}, g.n FROM g JOIN requests r ON r.id = g.last_id
         ORDER BY g.first_id LIMIT ?3 OFFSET ?4"
    ))?;
    let items = stmt
        .query_map(params![project_id, needle, limit, offset], |row| {
            Ok(RequestGroup {
                latest: map_summary(row)?,
                count: row.get(12)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(RequestPage {
        items,
        total,
        offset,
    })
}

/// Every visible occurrence of the same method + host + path as `request_id`, oldest first.
pub fn occurrences(conn: &Connection, request_id: i64) -> AppResult<Vec<RequestSummary>> {
    let visible = super::filters::VISIBLE;
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLUMNS} FROM requests o
         JOIN requests r ON r.project_id = o.project_id AND r.method = o.method
                        AND r.host = o.host AND r.path = o.path
         WHERE o.id = ?1 AND {visible}
         ORDER BY r.id DESC LIMIT ?2"
    ))?;
    let mut items = stmt
        .query_map(params![request_id, MAX_OCCURRENCES], map_summary)?
        .collect::<Result<Vec<_>, _>>()?;
    items.reverse();
    if items.is_empty() {
        return Err(AppError::NotFound(format!("Requête {request_id} introuvable")));
    }
    Ok(items)
}

pub fn get_detail(conn: &Connection, id: i64) -> AppResult<RequestDetail> {
    let detail = conn
        .query_row(
            &format!(
                "SELECT {SUMMARY_COLUMNS}, r.status_text, r.request_headers, r.request_body,
                        r.response_headers, r.response_body, r.response_body_encoding,
                        r.response_size, r.failure_text
                 FROM requests r WHERE r.id = ?1"
            ),
            [id],
            |row| {
                Ok((
                    map_summary(row)?,
                    row.get::<_, Option<String>>(12)?,
                    row.get::<_, String>(13)?,
                    row.get::<_, Option<String>>(14)?,
                    row.get::<_, String>(15)?,
                    row.get::<_, Option<String>>(16)?,
                    row.get::<_, String>(17)?,
                    row.get::<_, Option<i64>>(18)?,
                    row.get::<_, Option<String>>(19)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Requête {id} introuvable")))?;

    let (summary, status_text, req_h, request_body, res_h, response_body, enc, size, failure) =
        detail;
    let query_params = url::Url::parse(&summary.url)
        .map(|u| {
            u.query_pairs()
                .map(|(name, value)| QueryParam {
                    name: name.into_owned(),
                    value: value.into_owned(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(RequestDetail {
        summary,
        status_text,
        request_headers: parse_headers(&req_h)?,
        query_params,
        request_body,
        response_headers: parse_headers(&res_h)?,
        response_body,
        response_body_encoding: BodyEncoding::parse(&enc),
        response_size: size,
        failure_text: failure,
    })
}

pub fn summaries_by_ids(conn: &Connection, ids: &[i64]) -> AppResult<Vec<RequestSummary>> {
    let mut unique: Vec<i64> = ids.to_vec();
    unique.sort_unstable();
    unique.dedup();
    let mut stmt = conn.prepare(&format!("SELECT {SUMMARY_COLUMNS} FROM requests r WHERE r.id = ?1"))?;
    let mut out = Vec::with_capacity(unique.len());
    for id in unique {
        if let Some(summary) = stmt.query_row([id], map_summary).optional()? {
            out.push(summary);
        }
    }
    Ok(out)
}

pub fn exists_in_project(conn: &Connection, project_id: i64, request_id: i64) -> AppResult<bool> {
    let found: Option<i64> = conn
        .query_row(
            "SELECT 1 FROM requests WHERE id = ?1 AND project_id = ?2",
            params![request_id, project_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(found.is_some())
}

/// Streams every exchange of a project (in capture order) to the correlation engine.
pub fn for_each_exchange(
    conn: &Connection,
    project_id: i64,
    mut f: impl FnMut(ExchangeInput),
) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "SELECT id, method, url, request_headers, request_body, response_headers,
                CASE WHEN response_body_encoding = 'utf8' THEN response_body END
         FROM requests WHERE project_id = ?1 ORDER BY id",
    )?;
    let mut rows = stmt.query([project_id])?;
    while let Some(row) = rows.next()? {
        let req_h: String = row.get(3)?;
        let res_h: String = row.get(5)?;
        f(ExchangeInput {
            id: row.get(0)?,
            method: row.get(1)?,
            url: row.get(2)?,
            request_headers: parse_headers(&req_h)?,
            request_body: row.get(4)?,
            response_headers: parse_headers(&res_h)?,
            response_body: row.get(6)?,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::NewProject;

    #[test]
    fn groups_identical_requests() {
        let mut conn = Connection::open_in_memory().unwrap();
        super::super::migrations::run(&mut conn).unwrap();
        let project =
            super::super::projects::create(&conn, NewProject { name: "t".into(), start_url: None }).unwrap();
        let urls = ["/api/me", "/api/items?page=1", "/api/me", "/api/items?page=2", "/api/me"];
        for (i, url) in urls.iter().enumerate() {
            let path = url.split('?').next().unwrap();
            conn.execute(
                "INSERT INTO requests (id, project_id, method, url, host, path, resource_type, started_at,
                    request_headers, response_headers, response_body_encoding)
                 VALUES (?1, ?2, 'GET', ?3, 'a.org', ?4, 'fetch', 0, '[]', '[]', 'none')",
                params![i as i64 + 1, project.id, format!("https://a.org{url}"), path],
            )
            .unwrap();
        }
        let page = list(&conn, project.id, None, 0, 50).unwrap();
        assert_eq!(page.total, 2);
        let summary: Vec<(i64, i64)> = page.items.iter().map(|g| (g.latest.id, g.count)).collect();
        assert_eq!(summary, vec![(5, 3), (4, 2)]);
        let ids: Vec<i64> = occurrences(&conn, 3).unwrap().iter().map(|r| r.id).collect();
        assert_eq!(ids, vec![1, 3, 5]);
        assert_eq!(matching_ids(&conn, project.id, "me", &[1, 2, 3, 4]).unwrap(), vec![1, 3]);
    }
}
