use rusqlite::Connection;

use crate::error::AppResult;

/// Ordered migrations; index + 1 == `PRAGMA user_version` after applying.
const MIGRATIONS: &[&str] = &[r#"
CREATE TABLE projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    start_url   TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE requests (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    method                  TEXT    NOT NULL,
    url                     TEXT    NOT NULL,
    host                    TEXT    NOT NULL,
    path                    TEXT    NOT NULL,
    resource_type           TEXT    NOT NULL,
    started_at              INTEGER NOT NULL,
    duration_ms             REAL,
    status                  INTEGER,
    status_text             TEXT,
    mime_type               TEXT,
    request_headers         TEXT    NOT NULL,
    request_body            TEXT,
    response_headers        TEXT    NOT NULL,
    response_body           TEXT,
    response_body_encoding  TEXT    NOT NULL,
    response_size           INTEGER,
    failure_text            TEXT
);
CREATE INDEX idx_requests_project ON requests(project_id, id);

-- Contentless trigram index: substring search over URL, request & response.
CREATE VIRTUAL TABLE requests_fts USING fts5(
    url, request_text, response_text,
    content = '', contentless_delete = 1, tokenize = 'trigram'
);

CREATE TABLE links (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_request_id  INTEGER REFERENCES requests(id) ON DELETE CASCADE,
    target_request_id  INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    origin             TEXT    NOT NULL CHECK (origin IN ('auto', 'manual')),
    variables          TEXT    NOT NULL,
    created_at         INTEGER NOT NULL
);
CREATE INDEX idx_links_project ON links(project_id);

-- Nodes explicitly placed/pinned on the graph (x/y NULL = auto layout).
CREATE TABLE graph_nodes (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    node_key    TEXT    NOT NULL,
    x           REAL,
    y           REAL,
    PRIMARY KEY (project_id, node_key)
);
"#, r#"
-- Display-only exclusion globs (SQLite GLOB syntax), matched against path or full URL.
CREATE TABLE hidden_patterns (
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pattern     TEXT    NOT NULL,
    PRIMARY KEY (project_id, pattern)
);
"#, r#"
-- Grouping of identical requests (method + host + path) in the request list.
CREATE INDEX idx_requests_group ON requests(project_id, method, host, path, id);
"#, r#"
-- Global application settings, values are JSON documents.
CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"#];

pub fn run(conn: &mut Connection) -> AppResult<()> {
    let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    let current = usize::try_from(current).unwrap_or(0);

    for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (index + 1) as i64)?;
        tx.commit()?;
        log::info!("migration v{} applied", index + 1);
    }
    Ok(())
}
