/**
 * Domain types mirrored from the Rust backend (`src-tauri/src/models.rs`).
 * All payloads are serialized by serde in camelCase.
 */

export type RequestId = number;
export type ProjectId = number;
export type LinkId = number;

export interface HttpHeader {
  name: string;
  value: string;
}

export interface QueryParam {
  name: string;
  value: string;
}

export interface Project {
  id: ProjectId;
  name: string;
  startUrl: string | null;
  createdAt: number;
  updatedAt: number;
  requestCount: number;
}

export interface NewProject {
  name: string;
  startUrl: string | null;
}

export type BodyEncoding = "utf8" | "base64" | "none";

export interface RequestSummary {
  id: RequestId;
  projectId: ProjectId;
  method: string;
  url: string;
  host: string;
  path: string;
  resourceType: string;
  status: number | null;
  startedAt: number;
  durationMs: number | null;
  mimeType: string | null;
  failed: boolean;
}

export interface RequestDetail extends RequestSummary {
  statusText: string | null;
  requestHeaders: HttpHeader[];
  queryParams: QueryParam[];
  requestBody: string | null;
  responseHeaders: HttpHeader[];
  responseBody: string | null;
  responseBodyEncoding: BodyEncoding;
  responseSize: number | null;
  failureText: string | null;
}

/** Identical requests (method + host + path), represented by their latest occurrence. */
export interface RequestGroup extends RequestSummary {
  count: number;
}

/** Key shared by every occurrence of the same request. Must match the backend grouping. */
export function requestGroupKey(r: Pick<RequestSummary, "method" | "host" | "path">): string {
  return `${r.method} ${r.host}${r.path}`;
}

export interface RequestPage {
  items: RequestGroup[];
  total: number;
  offset: number;
}

export type LinkOrigin = "auto" | "manual";

export const VALUE_TYPES = ["jwt", "uuid", "email", "url", "number", "boolean", "string"] as const;
export type ValueType = (typeof VALUE_TYPES)[number];

export type DataLocation =
  | "responseBody"
  | "responseHeader"
  | "responseCookie"
  | "requestBody"
  | "requestHeader"
  | "requestCookie"
  | "requestQuery"
  | "requestPath"
  | "userInput"
  | "unknown";

export interface LinkVariable {
  name: string;
  targetName: string;
  valueType: ValueType;
  sourceLocation: DataLocation;
  targetLocation: DataLocation;
  sample: string | null;
}

export interface Link {
  id: LinkId;
  projectId: ProjectId;
  /** `null` => value originates from the user (virtual "user" node). */
  sourceRequestId: RequestId | null;
  targetRequestId: RequestId;
  origin: LinkOrigin;
  variables: LinkVariable[];
  createdAt: number;
}

export interface NewLink {
  projectId: ProjectId;
  sourceRequestId: RequestId | null;
  targetRequestId: RequestId;
  variables: LinkVariable[];
}

export interface GraphNodePosition {
  nodeKey: string;
  x: number | null;
  y: number | null;
}

export interface GraphData {
  requests: RequestSummary[];
  links: Link[];
  positions: GraphNodePosition[];
}

// --- Capture -----------------------------------------------------------------

/** `managed` = Chrome started by Playwright, `attach` = the user's Chrome via CDP. */
export type BrowserMode = "managed" | "attach";

export interface BrowserSettings {
  mode: BrowserMode;
  cdpEndpoint: string;
  autoLaunch: boolean;
  chromePath: string | null;
  profileDir: string | null;
}

/** Values applied when optional settings are empty. */
export interface BrowserDefaults {
  chromePath: string | null;
  profileDir: string;
}

export type CaptureState = "idle" | "starting" | "running" | "paused";

export interface CaptureStatus {
  state: CaptureState;
  projectId: ProjectId | null;
  captured: number;
  browserVersion: string | null;
}

export interface ExchangeEvent {
  projectId: ProjectId;
  request: RequestSummary;
  links: Link[];
  related: RequestSummary[];
}

export interface CaptureErrorEvent {
  projectId: ProjectId | null;
  message: string;
}
