//! Browser selection: Chrome launched by Playwright with a dedicated profile,
//! or the user's own Chrome reached through the DevTools protocol (CDP).

use std::io::{Read, Write};
use std::net::{IpAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use url::Url;

use super::protocol::CaptureTarget;
use crate::error::{AppError, AppResult, Msg};

const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:9222";
const CONNECT_TIMEOUT: Duration = Duration::from_millis(800);
const READ_TIMEOUT: Duration = Duration::from_secs(2);
/// A fresh profile can take a while to start (first run, antivirus scans…).
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum BrowserMode {
    /// Chrome started by Playwright (persistent dedicated profile).
    #[default]
    Managed,
    /// The user's Chrome, reached through `--remote-debugging-port`.
    Attach,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct BrowserSettings {
    pub mode: BrowserMode,
    /// `http://host:port` (or the `ws://` URL printed by Chrome).
    pub cdp_endpoint: String,
    /// Start Chrome with the debugging port when nothing listens on the endpoint.
    pub auto_launch: bool,
    /// `None` = auto-detected installation.
    pub chrome_path: Option<String>,
    /// `None` = profile folder managed by the application.
    pub profile_dir: Option<String>,
}

impl Default for BrowserSettings {
    fn default() -> Self {
        Self {
            mode: BrowserMode::Managed,
            cdp_endpoint: DEFAULT_ENDPOINT.into(),
            auto_launch: true,
            chrome_path: None,
            profile_dir: None,
        }
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

impl BrowserSettings {
    /// Trims fields and rejects malformed endpoints.
    pub fn normalized(self) -> AppResult<Self> {
        let endpoint = self.cdp_endpoint.trim();
        let cdp_endpoint = if endpoint.is_empty() { DEFAULT_ENDPOINT.to_owned() } else { endpoint.to_owned() };
        parse_endpoint(&cdp_endpoint)?;
        Ok(Self {
            cdp_endpoint,
            chrome_path: non_empty(self.chrome_path),
            profile_dir: non_empty(self.profile_dir),
            ..self
        })
    }
}

/// Values used when optional settings are left empty.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDefaults {
    pub chrome_path: Option<String>,
    pub profile_dir: String,
}

pub fn defaults(default_profile: &Path) -> BrowserDefaults {
    BrowserDefaults {
        chrome_path: detect_chrome().map(|p| p.to_string_lossy().into_owned()),
        profile_dir: default_profile.to_string_lossy().into_owned(),
    }
}

fn parse_endpoint(raw: &str) -> AppResult<(Url, String, u16)> {
    let invalid = || {
        AppError::InvalidInput(
            Msg::coded("invalidCdpEndpoint", format!("Invalid CDP endpoint: \"{raw}\" (e.g. {DEFAULT_ENDPOINT})"))
                .param("endpoint", raw)
                .param("example", DEFAULT_ENDPOINT),
        )
    };
    let url = Url::parse(raw).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https" | "ws" | "wss") {
        return Err(invalid());
    }
    let host = url.host_str().ok_or_else(invalid)?.trim_matches(['[', ']']).to_owned();
    let port = url.port_or_known_default().ok_or_else(invalid)?;
    Ok((url, host, port))
}

fn is_loopback(host: &str) -> bool {
    host.eq_ignore_ascii_case("localhost") || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

#[derive(Deserialize)]
struct VersionInfo {
    #[serde(rename = "Browser")]
    browser: String,
}

/// Reads one HTTP response. Chrome keeps the socket open despite
/// `Connection: close`, so the body is delimited by `Content-Length`.
fn read_http_response(stream: &mut TcpStream) -> std::io::Result<Vec<u8>> {
    const MAX: usize = 256 * 1024;
    let mut raw = Vec::new();
    let mut chunk = [0_u8; 8192];
    loop {
        let n = match stream.read(&mut chunk) {
            Ok(n) => n,
            // Timed out after receiving something: use what we have.
            Err(e) if !raw.is_empty() && matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => 0,
            Err(e) => return Err(e),
        };
        if n == 0 {
            break;
        }
        raw.extend_from_slice(&chunk[..n]);
        if raw.len() >= MAX || is_complete(&raw) {
            break;
        }
    }
    Ok(raw)
}

fn is_complete(raw: &[u8]) -> bool {
    let Some(header_end) = raw.windows(4).position(|w| w == b"\r\n\r\n") else {
        return false;
    };
    let headers = String::from_utf8_lossy(&raw[..header_end]);
    let length = headers.lines().find_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim().eq_ignore_ascii_case("content-length").then(|| value.trim().parse::<usize>().ok())?
    });
    length.is_some_and(|len| raw.len() >= header_end + 4 + len)
}

/// Queries `/json/version` and returns the browser version (e.g. `Chrome/156.0…`).
pub fn probe(endpoint: &str) -> AppResult<String> {
    let (_, host, port) = parse_endpoint(endpoint)?;
    let unreachable = || {
        AppError::Capture(
            Msg::coded(
                "chromeNotDebugging",
                format!("No Chrome in debugging mode on {host}:{port}. Launch it with --remote-debugging-port={port}."),
            )
            .param("address", format!("{host}:{port}"))
            .param("port", port),
        )
    };

    let addrs = (host.as_str(), port).to_socket_addrs().map_err(|_| unreachable())?;
    let mut stream = addrs
        .into_iter()
        .find_map(|addr| TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT).ok())
        .ok_or_else(unreachable)?;
    stream.set_read_timeout(Some(READ_TIMEOUT))?;
    stream.set_write_timeout(Some(READ_TIMEOUT))?;

    // Chrome rejects Host headers that are neither an IP nor "localhost".
    let host_header = if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
    write!(stream, "GET /json/version HTTP/1.1\r\nHost: {host_header}\r\nConnection: close\r\n\r\n")?;

    let raw = read_http_response(&mut stream).map_err(|_| unreachable())?;
    let text = String::from_utf8_lossy(&raw);
    let (Some(start), Some(end)) = (text.find('{'), text.rfind('}')) else {
        return Err(AppError::Capture(
            Msg::coded("notDevtoolsEndpoint", format!("{host}:{port} responds but is not a Chrome DevTools endpoint."))
                .param("address", format!("{host}:{port}")),
        ));
    };
    let info: VersionInfo = serde_json::from_str(&text[start..=end])
        .map_err(|_| {
            AppError::Capture(
                Msg::coded("devtoolsUnreadable", format!("Unreadable DevTools response from {host}:{port}."))
                    .param("address", format!("{host}:{port}")),
            )
        })?;
    Ok(info.browser)
}

/// Standard Google Chrome install locations.
pub fn detect_chrome() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            candidates.push(PathBuf::from(base).join(r"Google\Chrome\Application\chrome.exe"));
        }
    }
    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
    #[cfg(all(unix, not(target_os = "macos")))]
    for name in ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"] {
        candidates.push(PathBuf::from("/usr/bin").join(name));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// Chrome ≥ 136 ignores `--remote-debugging-port` on its default profile folder.
fn is_default_chrome_profile(dir: &Path) -> bool {
    #[cfg(windows)]
    let default = std::env::var_os("LOCALAPPDATA").map(|b| PathBuf::from(b).join(r"Google\Chrome\User Data"));
    #[cfg(target_os = "macos")]
    let default = std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support/Google/Chrome"));
    #[cfg(all(unix, not(target_os = "macos")))]
    let default = std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config/google-chrome"));

    let normalize = |p: &Path| {
        let s = p.to_string_lossy().replace('\\', "/");
        s.trim_end_matches('/').to_lowercase()
    };
    default.is_some_and(|d| normalize(&d) == normalize(dir))
}

/// Opens the user's Chrome with the debugging port (no-op if it already listens).
/// The browser is detached: it belongs to the user and survives the app.
pub fn launch_debug_chrome(settings: &BrowserSettings, default_profile: &Path) -> AppResult<String> {
    if let Ok(version) = probe(&settings.cdp_endpoint) {
        return Ok(version);
    }
    let (_, host, port) = parse_endpoint(&settings.cdp_endpoint)?;
    if !is_loopback(&host) {
        return Err(AppError::Capture(
            Msg::coded(
                "chromeUnreachableRemote",
                format!("No Chrome reachable on {host}:{port}. Automatic launch only works on this machine (localhost)."),
            )
            .param("address", format!("{host}:{port}")),
        ));
    }

    let chrome = match &settings.chrome_path {
        Some(path) => PathBuf::from(path),
        None => detect_chrome().ok_or_else(|| {
            AppError::Capture(Msg::coded(
                "chromeNotFound",
                "Google Chrome not found: set its path in the browser settings.",
            ))
        })?,
    };
    if !chrome.is_file() {
        return Err(AppError::Capture(
            Msg::coded("chromeExecutableNotFound", format!("Chrome executable not found: {}", chrome.display()))
                .param("path", chrome.display()),
        ));
    }

    let profile = settings.profile_dir.as_ref().map_or_else(|| default_profile.to_path_buf(), PathBuf::from);
    if is_default_chrome_profile(&profile) {
        return Err(AppError::Capture(Msg::coded(
            "chromeDefaultProfile",
            "Chrome refuses debugging mode on its default profile (\"User Data\"). Choose another profile folder.",
        )));
    }
    std::fs::create_dir_all(&profile)?;

    let mut child = Command::new(&chrome)
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", profile.display()))
        .args(["--no-first-run", "--no-default-browser-check"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            AppError::Capture(
                Msg::coded("chromeLaunchFailed", format!("Could not launch Chrome ({}): {e}", chrome.display()))
                    .param("path", chrome.display())
                    .param("error", &e),
            )
        })?;
    // Reap the process when the user closes it (avoids zombies on Unix).
    std::thread::spawn(move || {
        let _ = child.wait();
    });

    let deadline = Instant::now() + LAUNCH_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(300));
        if let Ok(version) = probe(&settings.cdp_endpoint) {
            return Ok(version);
        }
    }
    Err(AppError::Capture(
        Msg::coded(
            "chromePortClosed",
            format!(
                "Chrome started but does not open port {port}. Close the Chrome windows using the profile \"{}\" and try again.",
                profile.display()
            ),
        )
        .param("port", port)
        .param("profile", profile.display()),
    ))
}

/// Turns the settings into what the agent needs, opening Chrome first if required.
pub fn resolve_target(
    settings: &BrowserSettings,
    start_url: Option<String>,
    default_profile: &Path,
) -> AppResult<CaptureTarget> {
    match settings.mode {
        BrowserMode::Managed => Ok(CaptureTarget::Launch { start_url }),
        BrowserMode::Attach => {
            if settings.auto_launch {
                launch_debug_chrome(settings, default_profile)?;
            } else {
                probe(&settings.cdp_endpoint)?;
            }
            Ok(CaptureTarget::Cdp { endpoint: settings.cdp_endpoint.clone(), start_url })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_endpoints() {
        assert!(parse_endpoint("http://127.0.0.1:9222").is_ok());
        assert!(parse_endpoint("ws://localhost:9222/devtools/browser/abc").is_ok());
        assert!(parse_endpoint("localhost:9222").is_err());
        assert!(parse_endpoint("ftp://x:1").is_err());
        assert!(is_loopback("localhost") && is_loopback("127.0.0.1") && is_loopback("::1"));
        assert!(!is_loopback("192.168.1.10"));
    }

    #[test]
    fn normalizes_settings() {
        let s = BrowserSettings {
            cdp_endpoint: "  ".into(),
            chrome_path: Some("  ".into()),
            profile_dir: Some(" C:/p ".into()),
            ..BrowserSettings::default()
        }
        .normalized()
        .unwrap();
        assert_eq!(s.cdp_endpoint, DEFAULT_ENDPOINT);
        assert_eq!(s.chrome_path, None);
        assert_eq!(s.profile_dir.as_deref(), Some("C:/p"));
    }

    #[test]
    fn probe_fails_cleanly_when_nothing_listens() {
        assert!(probe("http://127.0.0.1:1").is_err());
    }

    /// `WA_CDP_ENDPOINT=http://127.0.0.1:9222 cargo test -- --ignored probe_live`
    #[test]
    #[ignore = "needs a Chrome started with --remote-debugging-port"]
    fn probe_live() {
        let endpoint = std::env::var("WA_CDP_ENDPOINT").unwrap_or_else(|_| DEFAULT_ENDPOINT.into());
        let version = probe(&endpoint).unwrap();
        assert!(version.starts_with("Chrome/"), "{version}");
    }
}
