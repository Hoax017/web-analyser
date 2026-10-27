use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::models::{now_ms, NewProject, Project};

const SELECT_PROJECT: &str = "
    SELECT p.id, p.name, p.start_url, p.created_at, p.updated_at,
           (SELECT COUNT(*) FROM requests r WHERE r.project_id = p.id)
    FROM projects p";

fn map_project(row: &Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        name: row.get(1)?,
        start_url: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        request_count: row.get(5)?,
    })
}

pub fn list(conn: &Connection) -> AppResult<Vec<Project>> {
    let mut stmt = conn.prepare(&format!("{SELECT_PROJECT} ORDER BY p.updated_at DESC"))?;
    let rows = stmt.query_map([], map_project)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Project> {
    conn.query_row(&format!("{SELECT_PROJECT} WHERE p.id = ?1"), [id], map_project)
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("Projet {id} introuvable")))
}

pub fn create(conn: &Connection, input: NewProject) -> AppResult<Project> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput("Le nom du projet est requis".into()));
    }
    let start_url = input
        .start_url
        .map(|u| u.trim().to_owned())
        .filter(|u| !u.is_empty());
    if let Some(url) = &start_url {
        url::Url::parse(url)
            .map_err(|e| AppError::InvalidInput(format!("URL de départ invalide : {e}")))?;
    }
    let now = now_ms();
    conn.execute(
        "INSERT INTO projects (name, start_url, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![name, start_url, now],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn delete(conn: &mut Connection, id: i64) -> AppResult<()> {
    let tx = conn.transaction()?;
    // Contentless FTS rows are not covered by ON DELETE CASCADE.
    tx.execute(
        "DELETE FROM requests_fts WHERE rowid IN (SELECT id FROM requests WHERE project_id = ?1)",
        [id],
    )?;
    let affected = tx.execute("DELETE FROM projects WHERE id = ?1", [id])?;
    if affected == 0 {
        return Err(AppError::NotFound(format!("Projet {id} introuvable")));
    }
    tx.commit()?;
    Ok(())
}
