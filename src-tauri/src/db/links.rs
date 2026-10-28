use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::correlation::DetectedLink;
use crate::error::{AppError, AppResult, Msg};
use crate::models::{now_ms, Link, LinkOrigin, LinkVariable, NewLink};

const SELECT_LINK: &str = "SELECT id, project_id, source_request_id, target_request_id, origin, \
    variables, created_at FROM links";

fn map_link(row: &Row<'_>) -> rusqlite::Result<(Link, String)> {
    let origin: String = row.get(4)?;
    Ok((
        Link {
            id: row.get(0)?,
            project_id: row.get(1)?,
            source_request_id: row.get(2)?,
            target_request_id: row.get(3)?,
            origin: LinkOrigin::parse(&origin),
            variables: Vec::new(),
            created_at: row.get(6)?,
        },
        row.get(5)?,
    ))
}

fn hydrate((mut link, variables): (Link, String)) -> AppResult<Link> {
    link.variables = serde_json::from_str(&variables)?;
    Ok(link)
}

pub fn list(conn: &Connection, project_id: i64) -> AppResult<Vec<Link>> {
    let mut stmt = conn.prepare(&format!("{SELECT_LINK} WHERE project_id = ?1 ORDER BY id"))?;
    let rows = stmt.query_map([project_id], map_link)?;
    rows.map(|r| hydrate(r?)).collect()
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Link> {
    let raw = conn
        .query_row(&format!("{SELECT_LINK} WHERE id = ?1"), [id], map_link)
        .optional()?
        .ok_or_else(|| AppError::NotFound(Msg::coded("linkNotFound", format!("Link {id} not found")).param("id", id)))?;
    hydrate(raw)
}

fn insert(
    conn: &Connection,
    project_id: i64,
    source: Option<i64>,
    target: i64,
    origin: LinkOrigin,
    variables: &[LinkVariable],
) -> AppResult<Link> {
    conn.execute(
        "INSERT INTO links (project_id, source_request_id, target_request_id, origin, variables, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            project_id,
            source,
            target,
            origin.as_str(),
            serde_json::to_string(variables)?,
            now_ms()
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn insert_detected(
    conn: &mut Connection,
    project_id: i64,
    detected: &[DetectedLink],
) -> AppResult<Vec<Link>> {
    if detected.is_empty() {
        return Ok(Vec::new());
    }
    let tx = conn.transaction()?;
    let mut out = Vec::with_capacity(detected.len());
    for d in detected {
        out.push(insert(
            &tx,
            project_id,
            d.source_request_id,
            d.target_request_id,
            LinkOrigin::Auto,
            &d.variables,
        )?);
    }
    tx.commit()?;
    Ok(out)
}

pub fn create_manual(conn: &Connection, input: &NewLink) -> AppResult<Link> {
    if input.source_request_id == Some(input.target_request_id) {
        return Err(AppError::InvalidInput(Msg::coded(
            "linkToItself",
            "A link cannot connect a request to itself",
        )));
    }
    for id in input.source_request_id.iter().chain([input.target_request_id].iter()) {
        if !super::requests::exists_in_project(conn, input.project_id, *id)? {
            return Err(AppError::InvalidInput(
                Msg::coded("requestNotInProject", format!("Request {id} does not belong to the project")).param("id", id),
            ));
        }
    }
    insert(
        conn,
        input.project_id,
        input.source_request_id,
        input.target_request_id,
        LinkOrigin::Manual,
        &input.variables,
    )
}

/// Editing a link marks it `manual` so that a re-analysis never overwrites it.
pub fn update_variables(conn: &Connection, id: i64, variables: &[LinkVariable]) -> AppResult<Link> {
    let affected = conn.execute(
        "UPDATE links SET variables = ?2, origin = 'manual' WHERE id = ?1",
        params![id, serde_json::to_string(variables)?],
    )?;
    if affected == 0 {
        return Err(AppError::NotFound(Msg::coded("linkNotFound", format!("Link {id} not found")).param("id", id)));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM links WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::NotFound(Msg::coded("linkNotFound", format!("Link {id} not found")).param("id", id)));
    }
    Ok(())
}

pub fn delete_auto(conn: &Connection, project_id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM links WHERE project_id = ?1 AND origin = 'auto'",
        [project_id],
    )?;
    Ok(())
}
