/** Message with one variant per CLDR plural category; `other` is the mandatory fallback. */
export type Plural = { [K in Intl.LDMLPluralRule]?: string } & { other: string };

export function pluralForms(forms: Plural): Plural {
  return forms;
}

/**
 * Codes of backend errors the UI can translate (mirror of `ErrorCode` in
 * src-tauri/src/error.rs). Unknown codes fall back to the backend message.
 */
export const ERROR_CODES = [
  "unknown",
  "captureAlreadyActive",
  "noActiveCapture",
  "agentNotFound",
  "nodeNotFound",
  "invalidCdpEndpoint",
  "chromeNotDebugging",
  "notDevtoolsEndpoint",
  "devtoolsUnreadable",
  "chromeUnreachableRemote",
  "chromeNotFound",
  "chromeExecutableNotFound",
  "chromeDefaultProfile",
  "chromeLaunchFailed",
  "chromePortClosed",
  "projectNotFound",
  "requestNotFound",
  "linkNotFound",
  "projectNameRequired",
  "invalidStartUrl",
  "linkToItself",
  "requestNotInProject",
  "stopCaptureFirst",
  "invalidPosition",
  "tooManyPatterns",
  "patternTooLong",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Backend error parameters; missing ones render as an empty string. */
export type ErrorParams = Readonly<Record<string, string>>;
