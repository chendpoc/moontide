import { exec } from "node:child_process";
import { promisify } from "node:util";

import { getWorkdir } from "../config.js";

const execAsync = promisify(exec);

export async function runBash(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: getWorkdir(),
      timeout: 120_000,
      maxBuffer: 50_000,
      encoding: "utf8",
      shell: "/bin/bash",
    });
    const output = `${stdout}${stderr}`.trim();
    return output || "(no output)";
  } catch (error) {
    if (error instanceof Error) {
      const execError = error as Error & { killed?: boolean; signal?: string };
      if (execError.killed || execError.signal === "SIGTERM") {
        return "Error: timeout (120s)";
      }
      const stdout = "stdout" in error ? String((error as { stdout?: string }).stdout ?? "") : "";
      const stderr = "stderr" in error ? String((error as { stderr?: string }).stderr ?? "") : "";
      const combined = `${stdout}${stderr}`.trim();
      if (combined) {
        return combined.slice(0, 50_000);
      }
      return `Error: ${error.message}`;
    }
    return `Error: ${String(error)}`;
  }
}
