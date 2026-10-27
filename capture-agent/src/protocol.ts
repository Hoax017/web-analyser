/**
 * Wire protocol between the capture agent and the Rust backend.
 * Agent -> Rust : NDJSON on stdout. Rust -> Agent : NDJSON on stdin.
 * Must stay in sync with `src-tauri/src/capture/protocol.rs`.
 */

export interface HttpHeader {
  name: string;
  value: string;
}

export type BodyEncoding = "utf8" | "base64" | "none";

export interface CapturedExchange {
  method: string;
  url: string;
  resourceType: string;
  startedAt: number;
  durationMs: number | null;
  requestHeaders: HttpHeader[];
  requestBody: string | null;
  status: number | null;
  statusText: string | null;
  mimeType: string | null;
  responseHeaders: HttpHeader[];
  responseBody: string | null;
  responseBodyEncoding: BodyEncoding;
  responseSize: number | null;
  failureText: string | null;
}

export type CaptureTarget =
  | { kind: "launch"; startUrl: string | null }
  | { kind: "cdp"; endpoint: string; startUrl: string | null };

export interface AgentConfig {
  target: CaptureTarget;
  userDataDir: string;
  captureStaticAssets: boolean;
  maxBodyBytes: number;
}

export type AgentCommand =
  | { type: "start"; config: AgentConfig }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "stop" };

export type AgentEvent =
  | { type: "ready"; browserVersion: string }
  | { type: "exchange"; data: CapturedExchange }
  | { type: "log"; level: "info" | "warn"; message: string }
  | { type: "error"; message: string }
  | { type: "closed" };

// ---------------------------------------------------------------------------
// Runtime validation of incoming commands (stdin is untrusted `unknown`).
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCaptureTarget(value: unknown): value is CaptureTarget {
  if (!isRecord(value)) return false;
  if (value["kind"] === "launch") {
    const startUrl = value["startUrl"];
    return startUrl === null || startUrl === undefined || typeof startUrl === "string";
  }
  const startUrl = value["startUrl"];
  return (
    value["kind"] === "cdp" &&
    typeof value["endpoint"] === "string" &&
    (startUrl === null || startUrl === undefined || typeof startUrl === "string")
  );
}

function isAgentConfig(value: unknown): value is AgentConfig {
  return (
    isRecord(value) &&
    isCaptureTarget(value["target"]) &&
    typeof value["userDataDir"] === "string" &&
    typeof value["captureStaticAssets"] === "boolean" &&
    typeof value["maxBodyBytes"] === "number"
  );
}

export function parseCommand(line: string): AgentCommand | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  switch (parsed["type"]) {
    case "start":
      return isAgentConfig(parsed["config"]) ? { type: "start", config: parsed["config"] } : null;
    case "pause":
      return { type: "pause" };
    case "resume":
      return { type: "resume" };
    case "stop":
      return { type: "stop" };
    default:
      return null;
  }
}

export function emit(event: AgentEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
