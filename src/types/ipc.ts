/**
 * Typed contract of every Tauri command and event.
 * Keys/args must match `#[tauri::command]` signatures (snake_case args are
 * exposed in camelCase by Tauri).
 */
import type {
  CaptureErrorEvent,
  CaptureStatus,
  BrowserDefaults,
  BrowserSettings,
  ExchangeEvent,
  GraphData,
  Link,
  LinkId,
  LinkVariable,
  NewLink,
  NewProject,
  Project,
  ProjectId,
  RequestDetail,
  RequestId,
  RequestPage,
  RequestSummary,
} from "./domain";

type NoArgs = Record<string, never>;

export type CommandMap = {
  list_projects: { args: NoArgs; result: Project[] };
  get_project: { args: { projectId: ProjectId }; result: Project };
  create_project: { args: { input: NewProject }; result: Project };
  delete_project: { args: { projectId: ProjectId }; result: null };
  get_hidden_patterns: { args: { projectId: ProjectId }; result: string[] };
  set_hidden_patterns: { args: { projectId: ProjectId; patterns: string[] }; result: string[] };

  list_requests: {
    args: { projectId: ProjectId; query: string | null; offset: number; limit: number };
    result: RequestPage;
  };
  get_request: { args: { requestId: RequestId }; result: RequestDetail };
  list_occurrences: { args: { requestId: RequestId }; result: RequestSummary[] };
  match_requests: {
    args: { projectId: ProjectId; query: string; requestIds: RequestId[] };
    result: RequestId[];
  };

  get_graph: { args: { projectId: ProjectId }; result: GraphData };
  create_link: { args: { input: NewLink }; result: Link };
  update_link: { args: { linkId: LinkId; variables: LinkVariable[] }; result: Link };
  delete_link: { args: { linkId: LinkId }; result: null };
  recompute_links: { args: { projectId: ProjectId }; result: GraphData };
  save_node_position: {
    args: { projectId: ProjectId; nodeKey: string; x: number; y: number };
    result: null;
  };
  save_node_positions: {
    args: { projectId: ProjectId; placements: { nodeKey: string; x: number; y: number }[] };
    result: null;
  };
  pin_request: { args: { projectId: ProjectId; requestId: RequestId }; result: null };
  unpin_request: { args: { projectId: ProjectId; requestId: RequestId }; result: null };

  start_capture: { args: { projectId: ProjectId }; result: CaptureStatus };
  pause_capture: { args: NoArgs; result: CaptureStatus };
  resume_capture: { args: NoArgs; result: CaptureStatus };
  stop_capture: { args: NoArgs; result: null };
  get_capture_status: { args: NoArgs; result: CaptureStatus };

  get_browser_settings: { args: NoArgs; result: BrowserSettings };
  set_browser_settings: { args: { settings: BrowserSettings }; result: BrowserSettings };
  get_browser_defaults: { args: NoArgs; result: BrowserDefaults };
  test_browser_connection: { args: { endpoint: string }; result: string };
  open_debug_browser: { args: { settings: BrowserSettings }; result: string };
};

export type CommandName = keyof CommandMap;
export type CommandArgs<K extends CommandName> = CommandMap[K]["args"];
export type CommandResult<K extends CommandName> = CommandMap[K]["result"];

export type EventMap = {
  "capture://status": CaptureStatus;
  "capture://exchange": ExchangeEvent;
  "capture://error": CaptureErrorEvent;
};

export type EventName = keyof EventMap;
