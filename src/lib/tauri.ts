import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isErrorCode, messages, translateError, type ErrorCode, type ErrorParams } from "@/i18n";
import type { CommandArgs, CommandName, CommandResult, EventMap, EventName } from "@/types/ipc";

export const APP_ERROR_KINDS = [
  "database",
  "serialization",
  "io",
  "tauri",
  "notFound",
  "invalidInput",
  "capture",
  "internal",
] as const;
export type AppErrorKind = (typeof APP_ERROR_KINDS)[number];

function isAppErrorKind(value: unknown): value is AppErrorKind {
  return typeof value === "string" && (APP_ERROR_KINDS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readParams(value: unknown): ErrorParams {
  if (!isRecord(value)) return {};
  const params: Record<string, string> = {};
  for (const [key, v] of Object.entries(value)) if (typeof v === "string") params[key] = v;
  return params;
}

/**
 * Error raised by the Rust backend (`AppError` serialized as `{ kind, message, code?, params? }`).
 * `message` is the English backend text; `code` + `params` let the UI translate it.
 */
export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly code: ErrorCode | null;
  readonly params: ErrorParams;

  constructor(kind: AppErrorKind, message: string, code: ErrorCode | null = null, params: ErrorParams = {}) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
    this.code = code;
    this.params = params;
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (isRecord(error) && typeof error["message"] === "string") {
      return new AppError(
        isAppErrorKind(error["kind"]) ? error["kind"] : "internal",
        error["message"],
        isErrorCode(error["code"]) ? error["code"] : null,
        readParams(error["params"]),
      );
    }
    if (error instanceof Error) return new AppError("internal", error.message);
    return typeof error === "string"
      ? new AppError("internal", error)
      : new AppError("internal", messages().errors.unknown({}), "unknown");
  }

  /** Message in the current UI language when the error is known, else the backend text. */
  localizedMessage(): string {
    return this.code === null ? this.message : translateError(this.code, this.params);
  }
}

export function errorMessage(error: unknown): string {
  return AppError.from(error).localizedMessage();
}

/** Strongly typed wrapper around `invoke`. Always rejects with an `AppError`. */
export async function command<K extends CommandName>(
  name: K,
  args: CommandArgs<K>,
): Promise<CommandResult<K>> {
  try {
    return await invoke<CommandResult<K>>(name, args);
  } catch (error: unknown) {
    throw AppError.from(error);
  }
}

/** Strongly typed wrapper around `listen`. */
export function onEvent<K extends EventName>(
  name: K,
  handler: (payload: EventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventMap[K]>(name, (event) => handler(event.payload));
}
