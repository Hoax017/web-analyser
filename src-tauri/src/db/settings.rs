//! Key/value application settings stored as JSON.

use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::error::AppResult;

pub const BROWSER: &str = "browser";

/// Missing or unreadable values (e.g. after a schema change) fall back to the default.
pub fn get<T: DeserializeOwned + Default>(conn: &Connection, key: &str) -> AppResult<T> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| row.get(0))
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default())
}

pub fn set<T: Serialize>(conn: &Connection, key: &str, value: &T) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, serde_json::to_string(value)?],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::browser::{BrowserMode, BrowserSettings};

    #[test]
    fn round_trips_and_defaults() {
        let mut conn = Connection::open_in_memory().unwrap();
        super::super::migrations::run(&mut conn).unwrap();

        let initial: BrowserSettings = get(&conn, BROWSER).unwrap();
        assert_eq!(initial, BrowserSettings::default());

        let custom = BrowserSettings { mode: BrowserMode::Attach, ..BrowserSettings::default() };
        set(&conn, BROWSER, &custom).unwrap();
        set(&conn, BROWSER, &custom).unwrap();
        let loaded: BrowserSettings = get(&conn, BROWSER).unwrap();
        assert_eq!(loaded, custom);
    }
}
