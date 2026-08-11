import { spawn } from "node:child_process";

import { loadStatusLineConfig } from "../../config/status-line.js";
import type { StatusLinePayload } from "./types.js";

export async function runStatusLineCommand(
  payload: StatusLinePayload,
  command: string,
  timeoutMs: number,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let settled = false;

    const finish = (value: string | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.on("error", () => finish(null));
    child.on("close", () => {
      const line = stdout.split("\n").find((row) => row.trim().length > 0)?.trim();
      finish(line ?? null);
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function resolveStatusLineFromConfig(
  payload: StatusLinePayload,
): Promise<string | null> {
  const config = loadStatusLineConfig();
  if (!config.command) {
    return null;
  }
  return runStatusLineCommand(payload, config.command, config.commandTimeoutMs);
}
