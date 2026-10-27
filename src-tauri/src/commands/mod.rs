//! Tauri IPC commands. Each command is `async` and delegates DB work to a
//! blocking thread; errors are returned as serialized `AppError`.

pub mod capture;
pub mod graph;
pub mod projects;
pub mod requests;
pub mod settings;
