import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

import { joinPath, resolvePath } from "../../../utils/path.js";

const execFileAsync = promisify(execFile);

export async function probeCommand(
  cmd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      encoding: "utf8",
      timeout: 5_000,
      env: env ?? process.env,
    });
    const version = `${stdout}${stderr}`.trim().split("\n")[0];
    return { ok: true, version };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function resolveCommand(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("which", [name], { encoding: "utf8", timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function localBin(name: string): string | undefined {
  const candidate = joinPath(resolvePath(process.cwd()), "node_modules", ".bin", name);
  return fs.existsSync(candidate) ? candidate : undefined;
}
