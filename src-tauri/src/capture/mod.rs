//! Capture session lifecycle: spawns the Node/Playwright agent, consumes its
//! NDJSON events, persists exchanges, runs correlation and notifies the UI.

pub mod browser;
pub mod protocol;

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::correlation::{CorrelationEngine, ExchangeInput};
use crate::db::{self, Database};
use crate::error::{AppError, AppResult, Msg};
use crate::models::{BodyEncoding, Link, RequestSummary};
use protocol::{AgentCommand, AgentConfig, AgentEvent, CaptureTarget, CapturedExchange};

pub const EVENT_STATUS: &str = "capture://status";
pub const EVENT_EXCHANGE: &str = "capture://exchange";
pub const EVENT_ERROR: &str = "capture://error";

const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CaptureState {
    Idle,
    Starting,
    Running,
    Paused,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatus {
    pub state: CaptureState,
    pub project_id: Option<i64>,
    pub captured: u64,
    pub browser_version: Option<String>,
}

impl CaptureStatus {
    fn idle() -> Self {
        Self { state: CaptureState::Idle, project_id: None, captured: 0, browser_version: None }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeEvent {
    pub project_id: i64,
    pub request: RequestSummary,
    pub links: Vec<Link>,
    /// Summaries of the source requests referenced by `links`.
    pub related: Vec<RequestSummary>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureErrorEvent {
    pub project_id: Option<i64>,
    pub message: String,
}

struct ActiveSession {
    child: Child,
    stdin: ChildStdin,
    status: CaptureStatus,
}

impl ActiveSession {
    fn send(&mut self, command: &AgentCommand) -> AppResult<()> {
        let mut line = serde_json::to_string(command)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes())?;
        self.stdin.flush()?;
        Ok(())
    }
}

#[derive(Default, Clone)]
pub struct CaptureManager {
    session: Arc<Mutex<Option<ActiveSession>>>,
}

fn lock(session: &Mutex<Option<ActiveSession>>) -> AppResult<MutexGuard<'_, Option<ActiveSession>>> {
    session
        .lock()
        .map_err(|_| AppError::Internal("poisoned session lock".into()))
}

fn emit_status(app: &AppHandle, status: &CaptureStatus) {
    if let Err(e) = app.emit(EVENT_STATUS, status) {
        log::warn!("could not emit status: {e}");
    }
}

fn emit_error(app: &AppHandle, project_id: Option<i64>, message: String) {
    log::error!("capture: {message}");
    let _ = app.emit(EVENT_ERROR, CaptureErrorEvent { project_id, message });
}

/// Resolution order: `WEB_ANALYSER_AGENT` env var, dev build output, bundled resource.
fn resolve_agent_script(app: &AppHandle) -> AppResult<PathBuf> {
    if let Ok(path) = std::env::var("WEB_ANALYSER_AGENT") {
        return Ok(PathBuf::from(path));
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("capture-agent")
        .join("dist")
        .join("index.js");
    if dev.exists() {
        return Ok(dev);
    }
    let bundled = app.path().resource_dir()?.join("capture-agent").join("index.js");
    if bundled.exists() {
        return Ok(bundled);
    }
    Err(AppError::Capture(Msg::coded(
        "agentNotFound",
        "Capture agent not found. Run `npm run build:agent`.",
    )))
}

/// Profile folder used when the user's Chrome is opened by the app in debugging mode.
pub fn debug_profile_dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app.path().app_data_dir()?.join("chrome-debug-profile"))
}

impl CaptureManager {
    pub fn status(&self) -> AppResult<CaptureStatus> {
        Ok(lock(&self.session)?
            .as_ref()
            .map(|s| s.status.clone())
            .unwrap_or_else(CaptureStatus::idle))
    }

    pub fn active_project(&self) -> AppResult<Option<i64>> {
        Ok(lock(&self.session)?.as_ref().and_then(|s| s.status.project_id))
    }

    pub fn start(
        &self,
        app: &AppHandle,
        db: Arc<Database>,
        project_id: i64,
        target: CaptureTarget,
    ) -> AppResult<CaptureStatus> {
        let mut guard = lock(&self.session)?;
        if guard.is_some() {
            return Err(AppError::Capture(Msg::coded("captureAlreadyActive", "A capture session is already active")));
        }
        // Validate project existence up-front for a clean error.
        db.with_conn(|c| db::projects::get(c, project_id))?;

        let script = resolve_agent_script(app)?;
        let node = std::env::var("WEB_ANALYSER_NODE").unwrap_or_else(|_| "node".into());
        let user_data_dir = app.path().app_data_dir()?.join("chrome-profile");
        std::fs::create_dir_all(&user_data_dir)?;

        let mut command = Command::new(&node);
        command
            .arg(&script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::Capture(
                    Msg::coded("nodeNotFound", format!("Node.js not found (\"{node}\"). Install Node ≥ 20.")).param("node", &node),
                )
            } else {
                AppError::Io(e)
            }
        })?;

        let stdout = child.stdout.take().ok_or_else(|| AppError::Internal("missing stdout".into()))?;
        let stderr = child.stderr.take().ok_or_else(|| AppError::Internal("missing stderr".into()))?;
        let stdin = child.stdin.take().ok_or_else(|| AppError::Internal("missing stdin".into()))?;

        let mut session = ActiveSession {
            child,
            stdin,
            status: CaptureStatus {
                state: CaptureState::Starting,
                project_id: Some(project_id),
                captured: 0,
                browser_version: None,
            },
        };
        session.send(&AgentCommand::Start {
            config: AgentConfig {
                target,
                user_data_dir: user_data_dir.to_string_lossy().into_owned(),
                capture_static_assets: false,
                max_body_bytes: MAX_BODY_BYTES,
            },
        })?;
        let status = session.status.clone();
        *guard = Some(session);
        drop(guard);

        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                log::debug!("[agent] {line}");
            }
        });

        let manager = self.clone();
        let app_handle = app.clone();
        std::thread::spawn(move || manager.read_loop(app_handle, db, project_id, stdout));

        emit_status(app, &status);
        Ok(status)
    }

    fn read_loop(&self, app: AppHandle, db: Arc<Database>, project_id: i64, stdout: std::process::ChildStdout) {
        let mut engine = CorrelationEngine::new();
        let warmup = db.with_conn(|c| {
            db::requests::for_each_exchange(c, project_id, |ex| {
                engine.process(&ex);
            })
        });
        if let Err(e) = warmup {
            emit_error(&app, Some(project_id), format!("Correlation warm-up failed: {e}"));
        }

        for line in BufReader::new(stdout).lines() {
            let line = match line {
                Ok(l) if l.trim().is_empty() => continue,
                Ok(l) => l,
                Err(e) => {
                    emit_error(&app, Some(project_id), format!("Reading from the agent failed: {e}"));
                    break;
                }
            };
            match serde_json::from_str::<AgentEvent>(&line) {
                Ok(AgentEvent::Ready { browser_version }) => {
                    self.update_status(&app, |s| {
                        s.state = CaptureState::Running;
                        s.browser_version = Some(browser_version);
                    });
                }
                Ok(AgentEvent::Exchange { data }) => {
                    match self.handle_exchange(&db, &mut engine, project_id, &data) {
                        Ok(event) => {
                            self.update_status(&app, |s| s.captured += 1);
                            if let Some(event) = event {
                                let _ = app.emit(EVENT_EXCHANGE, event);
                            }
                        }
                        Err(e) => emit_error(&app, Some(project_id), e.to_string()),
                    }
                }
                Ok(AgentEvent::Log { level, message }) => log::info!("[agent:{level}] {message}"),
                Ok(AgentEvent::Error { message }) => emit_error(&app, Some(project_id), message),
                Ok(AgentEvent::Closed) => break,
                Err(e) => log::warn!("invalid agent message ({e}): {line}"),
            }
        }

        self.cleanup(&app);
    }

    /// Stores and correlates an exchange. Returns `None` when the request is hidden
    /// by a display filter (it is still persisted and used for correlation).
    fn handle_exchange(
        &self,
        db: &Database,
        engine: &mut CorrelationEngine,
        project_id: i64,
        ex: &CapturedExchange,
    ) -> AppResult<Option<ExchangeEvent>> {
        db.with_conn(|conn| {
            let request = db::requests::insert_exchange(conn, project_id, ex)?;
            let detected = engine.process(&ExchangeInput {
                id: request.id,
                method: ex.method.clone(),
                url: ex.url.clone(),
                request_headers: ex.request_headers.clone(),
                request_body: ex.request_body.clone(),
                response_headers: ex.response_headers.clone(),
                response_body: match ex.response_body_encoding {
                    BodyEncoding::Utf8 => ex.response_body.clone(),
                    _ => None,
                },
            });
            let links = db::links::insert_detected(conn, project_id, &detected)?;
            let mut ids: Vec<i64> = links.iter().filter_map(|l| l.source_request_id).collect();
            ids.push(request.id);
            let visible = db::filters::visible_ids(conn, &ids)?;
            if !visible.contains(&request.id) {
                return Ok(None);
            }
            let links: Vec<_> = links
                .into_iter()
                .filter(|l| l.source_request_id.map_or(true, |s| visible.contains(&s)))
                .collect();
            let source_ids: Vec<i64> = links.iter().filter_map(|l| l.source_request_id).collect();
            let related = db::requests::summaries_by_ids(conn, &source_ids)?;
            Ok(Some(ExchangeEvent { project_id, request, links, related }))
        })
    }

    fn update_status(&self, app: &AppHandle, f: impl FnOnce(&mut CaptureStatus)) {
        let snapshot = match lock(&self.session) {
            Ok(mut guard) => guard.as_mut().map(|s| {
                f(&mut s.status);
                s.status.clone()
            }),
            Err(_) => None,
        };
        if let Some(status) = snapshot {
            emit_status(app, &status);
        }
    }

    fn cleanup(&self, app: &AppHandle) {
        if let Ok(mut guard) = lock(&self.session) {
            if let Some(mut session) = guard.take() {
                let _ = session.child.kill();
                let _ = session.child.wait();
            }
        }
        emit_status(app, &CaptureStatus::idle());
    }

    fn send_and_set(&self, app: &AppHandle, command: AgentCommand, state: CaptureState) -> AppResult<CaptureStatus> {
        let status = {
            let mut guard = lock(&self.session)?;
            let session = guard
                .as_mut()
                .ok_or_else(|| AppError::Capture(Msg::coded("noActiveCapture", "No active capture session")))?;
            session.send(&command)?;
            session.status.state = state;
            session.status.clone()
        };
        emit_status(app, &status);
        Ok(status)
    }

    pub fn pause(&self, app: &AppHandle) -> AppResult<CaptureStatus> {
        self.send_and_set(app, AgentCommand::Pause, CaptureState::Paused)
    }

    pub fn resume(&self, app: &AppHandle) -> AppResult<CaptureStatus> {
        self.send_and_set(app, AgentCommand::Resume, CaptureState::Running)
    }

    /// Graceful stop; the reader thread performs the final cleanup.
    pub fn stop(&self) -> AppResult<()> {
        let mut guard = lock(&self.session)?;
        if let Some(session) = guard.as_mut() {
            if session.send(&AgentCommand::Stop).is_err() {
                let _ = session.child.kill();
            }
        }
        Ok(())
    }

    /// Hard kill, used when the application exits.
    pub fn shutdown(&self) {
        if let Ok(mut guard) = lock(&self.session) {
            if let Some(mut session) = guard.take() {
                let _ = session.send(&AgentCommand::Stop);
                let _ = session.child.kill();
            }
        }
    }
}
