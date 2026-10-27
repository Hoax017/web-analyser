/**
 * Capture agent entry point. Spawned by the Tauri backend; receives commands
 * on stdin and streams captured HTTP exchanges on stdout (NDJSON).
 * Logs must go to stderr: stdout is reserved for the protocol.
 */
import { createInterface } from "node:readline";

import { emit, parseCommand } from "./protocol.js";
import { CaptureSession } from "./session.js";

let session: CaptureSession | null = null;

function fail(message: string): never {
  emit({ type: "error", message });
  emit({ type: "closed" });
  process.exit(1);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

input.on("line", (line) => {
  const command = parseCommand(line);
  if (command === null) {
    process.stderr.write(`commande invalide ignorée : ${line}\n`);
    return;
  }
  switch (command.type) {
    case "start":
      if (session !== null) return;
      session = new CaptureSession(command.config);
      session.start().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        fail(`Démarrage du navigateur impossible : ${message}`);
      });
      break;
    case "pause":
      session?.setPaused(true);
      break;
    case "resume":
      session?.setPaused(false);
      break;
    case "stop":
      if (session) void session.shutdown();
      else process.exit(0);
      break;
  }
});

// Parent process died: never leave an orphan browser behind.
input.on("close", () => {
  if (session) void session.shutdown();
  else process.exit(0);
});
