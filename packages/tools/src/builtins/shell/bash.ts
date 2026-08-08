import { execShell } from "@moontide/shared/utils/process.js";

export async function runBash(workdir: string, command: string): Promise<string> {
  const result = await execShell(command, {
    cwd: workdir,
    timeout: 120_000,
    maxBuffer: 50_000,
  });

  if (!result.error) {
    const output = `${result.stdout}${result.stderr}`.trim();
    return output || "(no output)";
  }

  const execError = result.error as Error & { killed?: boolean; signal?: string };
  if (execError.killed || execError.signal === "SIGTERM") {
    return "Error: timeout (120s)";
  }
  const combined = `${result.stdout}${result.stderr}`.trim();
  if (combined) {
    return combined.slice(0, 50_000);
  }
  return `Error: ${execError.message}`;
}
