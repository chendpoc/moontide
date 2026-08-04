import { exists } from "../../../utils/fs.js";
import { joinPath, resolvePath } from "../../../utils/path.js";
import { execFileCollect } from "../../../utils/process.js";

export async function probeCommand(
  cmd: string,
  args: string[],
  env?: Record<string, string>,
): Promise<{ ok: boolean; version?: string; error?: string }> {
  const result = await execFileCollect(cmd, args, {
    timeout: 5_000,
    env: env ?? process.env,
  });
  if (!result.error) {
    const version = `${result.stdout}${result.stderr}`.trim().split("\n")[0];
    return { ok: true, version };
  }
  return {
    ok: false,
    error: result.error.message,
  };
}

export async function resolveCommand(name: string): Promise<string | undefined> {
  const result = await execFileCollect("which", [name], { timeout: 5_000 });
  if (result.error) {
    return undefined;
  }
  return result.stdout.trim() || undefined;
}

export function localBin(name: string): string | undefined {
  const candidate = joinPath(resolvePath(process.cwd()), "node_modules", ".bin", name);
  return exists(candidate) ? candidate : undefined;
}
