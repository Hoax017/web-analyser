/** Typed API facade over Tauri commands, grouped by domain. */
import { command } from "@/lib/tauri";
import type {
  BrowserSettings,
  LinkVariable,
  NewLink,
  NewProject,
  ProjectId,
  RequestId,
  LinkId,
} from "@/types/domain";

export const projectsApi = {
  list: () => command("list_projects", {}),
  get: (projectId: ProjectId) => command("get_project", { projectId }),
  create: (input: NewProject) => command("create_project", { input }),
  remove: (projectId: ProjectId) => command("delete_project", { projectId }),
  hiddenPatterns: (projectId: ProjectId) => command("get_hidden_patterns", { projectId }),
  setHiddenPatterns: (projectId: ProjectId, patterns: string[]) =>
    command("set_hidden_patterns", { projectId, patterns }),
};

export const requestsApi = {
  list: (projectId: ProjectId, query: string | null, offset: number, limit: number) =>
    command("list_requests", { projectId, query, offset, limit }),
  get: (requestId: RequestId) => command("get_request", { requestId }),
  occurrences: (requestId: RequestId) => command("list_occurrences", { requestId }),
  /** Subset of `requestIds` matching the search query. */
  match: (projectId: ProjectId, query: string, requestIds: RequestId[]) =>
    command("match_requests", { projectId, query, requestIds }),
};

export const graphApi = {
  get: (projectId: ProjectId) => command("get_graph", { projectId }),
  recompute: (projectId: ProjectId) => command("recompute_links", { projectId }),
  createLink: (input: NewLink) => command("create_link", { input }),
  updateLink: (linkId: LinkId, variables: LinkVariable[]) =>
    command("update_link", { linkId, variables }),
  deleteLink: (linkId: LinkId) => command("delete_link", { linkId }),
  savePosition: (projectId: ProjectId, nodeKey: string, x: number, y: number) =>
    command("save_node_position", { projectId, nodeKey, x, y }),
  savePositions: (projectId: ProjectId, placements: { nodeKey: string; x: number; y: number }[]) =>
    command("save_node_positions", { projectId, placements }),
  pin: (projectId: ProjectId, requestId: RequestId) => command("pin_request", { projectId, requestId }),
  unpin: (projectId: ProjectId, requestId: RequestId) =>
    command("unpin_request", { projectId, requestId }),
};

export const captureApi = {
  /** Uses the browser configured in the settings. */
  start: (projectId: ProjectId) => command("start_capture", { projectId }),
  pause: () => command("pause_capture", {}),
  resume: () => command("resume_capture", {}),
  stop: () => command("stop_capture", {}),
  status: () => command("get_capture_status", {}),
};

export const settingsApi = {
  browser: () => command("get_browser_settings", {}),
  saveBrowser: (settings: BrowserSettings) => command("set_browser_settings", { settings }),
  browserDefaults: () => command("get_browser_defaults", {}),
  testConnection: (endpoint: string) => command("test_browser_connection", { endpoint }),
  openDebugBrowser: (settings: BrowserSettings) => command("open_debug_browser", { settings }),
};
