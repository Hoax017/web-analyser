import type { HttpHeader } from "@/types/domain";

export interface CurlInput {
  method: string;
  url: string;
  headers: readonly HttpHeader[];
  body: string | null;
}

/** Headers curl computes itself, or that would break the replay. */
const SKIPPED_HEADERS = new Set(["host", "content-length", "connection", "accept-encoding"]);

/** Quotes a value for a POSIX shell (sh, bash, zsh): single quotes, `'` → `'\''`. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Builds a multi-line POSIX `curl` command reproducing a captured request. */
export function toCurl({ method, url, headers, body }: CurlInput): string {
  const verb = method.toUpperCase();
  const hasBody = body !== null && body !== "";
  const args: string[] = [shellQuote(url)];

  if (verb === "HEAD") args.push("--head");
  else if (!(verb === "GET" && !hasBody) && !(verb === "POST" && hasBody)) args.push(`-X ${verb}`);

  for (const { name, value } of headers) {
    // HTTP/2 pseudo-headers (:authority, :path…) are not real headers.
    if (name.startsWith(":") || SKIPPED_HEADERS.has(name.toLowerCase())) continue;
    args.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (headers.some((h) => h.name.toLowerCase() === "accept-encoding")) args.push("--compressed");
  if (body !== null && body !== "") args.push(`--data-raw ${shellQuote(body)}`);

  return `curl ${args.join(" \\\n  ")}`;
}
