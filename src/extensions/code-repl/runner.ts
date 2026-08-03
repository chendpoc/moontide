import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

import { codeReplTimeoutMs, getWorkdir } from "../../config.js";
import { TMP_DIR } from "../../constants/storage.js";
import { safePath, runWrite } from "../../builtins/fs.js";
import { newEventId } from "../../utils/id.js";
import { dataPath, extname, joinPath, relativePath } from "../../utils/path.js";
import { ensureDir } from "../../storage/fs.js";
import { buildRuntimeEnv } from "./runtimes/env.js";
import type { CodeReplInput, CodeReplResult, CodeRuntime, ExecuteContext } from "./types.js";
import { OUTPUT_LIMIT } from "./types.js";

const execFileAsync = promisify(execFile);

export function pickExtension(runtime: CodeRuntime, filePath?: string): string {
  if (filePath) {
    const ext = extname(filePath);
    if (ext && runtime.extensions.includes(ext)) {
      return ext;
    }
  }
  return runtime.extensions[0] ?? ".txt";
}

export function truncateOutput(stdout: string, stderr: string): { stdout: string; stderr: string; truncated: boolean } {
  const combined = stdout.length + stderr.length;
  if (combined <= OUTPUT_LIMIT) {
    return { stdout, stderr, truncated: false };
  }
  const half = Math.floor(OUTPUT_LIMIT / 2);
  return {
    stdout: stdout.slice(0, half),
    stderr: stderr.slice(0, half),
    truncated: true,
  };
}

export interface PreparedScript {
  absolutePath: string;
  relativePath: string;
  cleanup: boolean;
}

export function prepareScript(
  input: CodeReplInput,
  runtime: CodeRuntime,
): PreparedScript | { error: string } {
  const code = input.code !== undefined ? String(input.code) : undefined;
  const filePath = input.path !== undefined ? String(input.path) : undefined;
  const workdir = getWorkdir();
  const persist = input.persist === true;

  if (code && filePath) {
    runWrite(filePath, code);
    return {
      absolutePath: safePath(filePath),
      relativePath: filePath,
      cleanup: false,
    };
  }

  if (filePath) {
    const absolutePath = safePath(filePath);
    if (!fs.existsSync(absolutePath)) {
      return { error: `file not found: ${filePath}` };
    }
    return { absolutePath, relativePath: filePath, cleanup: false };
  }

  const ext = pickExtension(runtime, filePath);
  const tmpDir = dataPath(workdir, TMP_DIR);
  ensureDir(tmpDir);
  const fileName = `${newEventId()}${ext}`;
  const absolutePath = joinPath(tmpDir, fileName);
  const scriptRelativePath = relativePath(workdir, absolutePath);
  fs.writeFileSync(absolutePath, code!, "utf8");
  return { absolutePath, relativePath: scriptRelativePath, cleanup: !persist };
}

export async function runPreparedScript(
  runtime: CodeRuntime,
  resolvedRuntimeId: string,
  script: PreparedScript,
  input: CodeReplInput,
): Promise<string> {
  const workdir = getWorkdir();
  const timeoutMs =
    input.timeout_ms !== undefined && Number.isFinite(Number(input.timeout_ms))
      ? Number(input.timeout_ms)
      : codeReplTimeoutMs();
  const args = Array.isArray(input.args) ? input.args.map(String) : [];

  const ctx: ExecuteContext = {
    filePath: script.absolutePath,
    workdir,
    args,
    timeoutMs,
    env: buildRuntimeEnv(),
  };

  const { cmd, args: cmdArgs } = runtime.buildCommand(ctx);
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(cmd, cmdArgs, {
      cwd: workdir,
      timeout: timeoutMs,
      maxBuffer: OUTPUT_LIMIT,
      encoding: "utf8",
      env: ctx.env,
    });
    const duration_ms = Date.now() - start;
    const trimmed = truncateOutput(String(stdout ?? ""), String(stderr ?? ""));
    const result: CodeReplResult = {
      runtime: resolvedRuntimeId,
      exit_code: 0,
      stdout: trimmed.stdout.trim(),
      stderr: trimmed.stderr.trim(),
      duration_ms,
      executed_path: script.relativePath,
      ...(trimmed.truncated ? { truncated: true } : {}),
    };
    return JSON.stringify(result);
  } catch (error) {
    const duration_ms = Date.now() - start;
    if (error instanceof Error) {
      const execError = error as Error & {
        killed?: boolean;
        signal?: string;
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      if (execError.killed || execError.signal === "SIGTERM") {
        return JSON.stringify({
          runtime: resolvedRuntimeId,
          exit_code: -1,
          stdout: "",
          stderr: "",
          duration_ms,
          executed_path: script.relativePath,
          error: `timeout (${timeoutMs}ms)`,
        } satisfies CodeReplResult);
      }
      const trimmed = truncateOutput(
        String(execError.stdout ?? ""),
        String(execError.stderr ?? ""),
      );
      const result: CodeReplResult = {
        runtime: resolvedRuntimeId,
        exit_code: typeof execError.code === "number" ? execError.code : 1,
        stdout: trimmed.stdout.trim(),
        stderr: trimmed.stderr.trim() || execError.message,
        duration_ms,
        executed_path: script.relativePath,
        ...(trimmed.truncated ? { truncated: true } : {}),
      };
      return JSON.stringify(result);
    }
    return JSON.stringify({
      runtime: resolvedRuntimeId,
      exit_code: 1,
      stdout: "",
      stderr: String(error),
      duration_ms,
      executed_path: script.relativePath,
      error: String(error),
    } satisfies CodeReplResult);
  }
}

export function cleanupScript(script: PreparedScript): void {
  if (!script.cleanup) {
    return;
  }
  try {
    fs.unlinkSync(script.absolutePath);
  } catch {
    // ignore cleanup errors
  }
}
