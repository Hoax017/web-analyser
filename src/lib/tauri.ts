import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

/** Error raised by the Rust backend (`AppError` serialized as `{ kind, message }`). */
export class AppError extends Error {
  readonly kind: AppErrorKind;

  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }

  static from(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (isRecord(error) && typeof error["message"] === "string") {
      return new AppError(isAppErrorKind(error["kind"]) ? error["kind"] : "internal", error["message"]);
    }
    if (error instanceof Error) return new AppError("internal", error.message);
    return new AppError("internal", typeof error === "string" ? error : "Erreur inconnue");
  }
}

export function errorMessage(error: unknown): string {
  return AppError.from(error).message;
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
