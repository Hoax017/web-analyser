import type { DataLocation, ValueType } from "@/types/domain";

export type StatusTone = "success" | "redirect" | "clientError" | "serverError" | "pending";

export function statusTone(status: number | null, failed: boolean): StatusTone {
  if (failed) return "serverError";
  if (status === null) return "pending";
  if (status >= 500) return "serverError";
  if (status >= 400) return "clientError";
  if (status >= 300) return "redirect";
  return "success";
}

const VALUE_TYPE_LABELS: Record<ValueType, string> = {
  jwt: "JWT",
  uuid: "UUID",
  email: "email",
  url: "url",
  number: "number",
  boolean: "boolean",
  string: "string",
};

export function valueTypeLabel(type: ValueType): string {
  return VALUE_TYPE_LABELS[type];
}

const LOCATION_LABELS: Record<DataLocation, string> = {
  responseBody: "corps de réponse",
  responseHeader: "en-tête de réponse",
  responseCookie: "cookie (Set-Cookie)",
  requestBody: "corps de requête",
  requestHeader: "en-tête",
  requestCookie: "cookie",
  requestQuery: "paramètre d'URL",
  requestPath: "segment d'URL",
  userInput: "saisie utilisateur",
  unknown: "—",
};

export function locationLabel(location: DataLocation): string {
  return LOCATION_LABELS[location];
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

const dateFormatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });
const timeFormatter = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function formatDate(ms: number): string {
  return dateFormatter.format(ms);
}

export function formatTime(ms: number): string {
  return timeFormatter.format(ms);
}

/** Pretty-prints JSON when possible, otherwise returns the raw text. */
export function prettyBody(body: string): { text: string; isJson: boolean } {
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      // Not valid JSON, fall through.
    }
  }
  return { text: body, isJson: false };
}
