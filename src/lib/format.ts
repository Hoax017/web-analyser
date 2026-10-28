import { currentTag, messages } from "@/i18n";
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

export function locationLabel(location: DataLocation): string {
  return messages().location[location];
}

/** Formatters are cached per locale tag; they are rebuilt lazily after a language change. */
function cached<T>(build: (tag: string) => T): () => T {
  const cache = new Map<string, T>();
  return () => {
    const tag = currentTag();
    let value = cache.get(tag);
    if (value === undefined) {
      value = build(tag);
      cache.set(tag, value);
    }
    return value;
  };
}

const unitFormatter = (unit: string, digits: number) =>
  cached((tag) => new Intl.NumberFormat(tag, { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: digits }));
const bytes = unitFormatter("byte", 0);
const kilobytes = unitFormatter("kilobyte", 1);
const megabytes = unitFormatter("megabyte", 1);
const milliseconds = unitFormatter("millisecond", 0);
const seconds = unitFormatter("second", 2);

export function formatBytes(size: number | null): string {
  if (size === null) return "—";
  if (size < 1024) return bytes().format(size);
  if (size < 1024 * 1024) return kilobytes().format(size / 1024);
  return megabytes().format(size / (1024 * 1024));
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  return ms < 1000 ? milliseconds().format(Math.round(ms)) : seconds().format(ms / 1000);
}

const dateFormatter = cached((tag) => new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }));
const timeFormatter = cached(
  (tag) => new Intl.DateTimeFormat(tag, { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
);

export function formatDate(ms: number): string {
  return dateFormatter().format(ms);
}

export function formatTime(ms: number): string {
  return timeFormatter().format(ms);
}

const numberFormatter = cached((tag) => new Intl.NumberFormat(tag));

export function formatNumber(value: number): string {
  return numberFormatter().format(value);
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
