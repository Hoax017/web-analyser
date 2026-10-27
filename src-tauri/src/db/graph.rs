use std::collections::HashSet;

use rusqlite::{params, Connection};

use super::requests::{map_summary, SUMMARY_COLUMNS};
use crate::error::AppResult;
use crate::models::{GraphData, GraphNodePosition, NodePlacement};

pub fn request_node_key(request_id: i64) -> String {
    format!("req:{request_id}")
}

/// Graph = every visible request involved in a link + every request pinned by the user.
/// Links touching a hidden request are dropped.
pub fn get(conn: &Connection, project_id: i64) -> AppResult<GraphData> {
    let visible = super::filters::VISIBLE;
    let mut stmt = conn.prepare(&format!(
        "SELECT {SUMMARY_COLUMNS} FROM requests r
         WHERE r.project_id = ?1 AND {visible} AND (
            r.id IN (SELECT source_request_id FROM links WHERE project_id = ?1)
            OR r.id IN (SELECT target_request_id FROM links WHERE project_id = ?1)
            OR r.id IN (SELECT CAST(substr(node_key, 5) AS INTEGER) FROM graph_nodes
                        WHERE project_id = ?1 AND node_key LIKE 'req:%')
         )
         ORDER BY r.id"
    ))?;
    let requests = stmt
        .query_map([project_id], map_summary)?
        .collect::<Result<Vec<_>, _>>()?;

    let mut stmt =
        conn.prepare("SELECT node_key, x, y FROM graph_nodes WHERE project_id = ?1")?;
    let positions = stmt
        .query_map([project_id], |row| {
            Ok(GraphNodePosition {
                node_key: row.get(0)?,
                x: row.get(1)?,
                y: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let shown: HashSet<i64> = requests.iter().map(|r| r.id).collect();
    let links = super::links::list(conn, project_id)?
        .into_iter()
        .filter(|l| shown.contains(&l.target_request_id) && l.source_request_id.map_or(true, |s| shown.contains(&s)))
        .collect();

    Ok(GraphData {
        requests,
        links,
        positions,
    })
}

pub fn save_position(conn: &Connection, project_id: i64, node_key: &str, x: f64, y: f64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO graph_nodes (project_id, node_key, x, y) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (project_id, node_key) DO UPDATE SET x = excluded.x, y = excluded.y",
        params![project_id, node_key, x, y],
    )?;
    Ok(())
}

pub fn save_positions(conn: &mut Connection, project_id: i64, placements: &[NodePlacement]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for p in placements {
        save_position(&tx, project_id, &p.node_key, p.x, p.y)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn pin(conn: &Connection, project_id: i64, node_key: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO graph_nodes (project_id, node_key, x, y) VALUES (?1, ?2, NULL, NULL)",
        params![project_id, node_key],
    )?;
    Ok(())
}

pub fn unpin(conn: &Connection, project_id: i64, node_key: &str) -> AppResult<()> {
    conn.execute(
        "DELETE FROM graph_nodes WHERE project_id = ?1 AND node_key = ?2",
        params![project_id, node_key],
    )?;
    Ok(())
}
