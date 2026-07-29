import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { DATA_DIR, codeReplDefaultRuntime, codeReplTimeoutMs, getWorkdir, pythonPath, venvPath } from "../../config.js";
import { safePath, runWrite } from "../fs.js";
import { getRuntime } from "./registry.js";
import type { CodeReplInput, CodeReplResult, CodeRuntime, ExecuteContext } from "./types.js";
import { OUTPUT_LIMIT } from "./types.js";

const execFileAsync = promisify(execFile);

const DENY_CODE_PATTERNS = ["rm -rf /", "sudo", "shutdown", "reboot", "> /dev/"];

function buildRuntimeEnv(): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  const venv = venvPath();
  if (venv) {
    const binDir = path.join(path.resolve(venv), "bin");
    env.PATH = `${binDir}${path.delimiter}${env.PATH ?? ""}`;
    env.VIRTUAL_ENV = path.resolve(venv);
  }
  return env;
}

async function probeCommand(
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

async function resolveCommand(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("which", [name], { encoding: "utf8", timeout: 5_000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

function pickExtension(runtime: CodeRuntime, filePath?: string): string {
  if (filePath) {
    const ext = path.extname(filePath);
    if (ext && runtime.extensions.includes(ext)) {
      return ext;
    }
  }
  return runtime.extensions[0] ?? ".txt";
}

function truncateOutput(stdout: string, stderr: string): { stdout: string; stderr: string; truncated: boolean } {
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

export async function executeCodeRepl(input: CodeReplInput): Promise<string> {
  const code = input.code !== undefined ? String(input.code) : undefined;
  const filePath = input.path !== undefined ? String(input.path) : undefined;

  if (!code && !filePath) {
    return JSON.stringify({
      error: "Either code or path is required",
    } satisfies Partial<CodeReplResult>);
  }

  for (const pattern of DENY_CODE_PATTERNS) {
    if (code?.includes(pattern)) {
      return JSON.stringify({
        error: `blocked: code contains forbidden pattern (${pattern})`,
      } satisfies Partial<CodeReplResult>);
    }
  }

  const runtimeId = input.runtime?.trim() || undefined;
  const resolvedRuntimeId = runtimeId || codeReplDefaultRuntime();
  const runtime = getRuntime(resolvedRuntimeId);

  if (!runtime) {
    return JSON.stringify({
      error: `unknown runtime: ${resolvedRuntimeId}`,
      suggestion: "call askUserQuestion to pick runtime or interpreter path",
    } satisfies Partial<CodeReplResult>);
  }

  const probe = await runtime.detect();
  if (!probe.available) {
    return JSON.stringify({
      runtime: resolvedRuntimeId,
      error: probe.error ?? `runtime ${resolvedRuntimeId} is not available`,
      suggestion: "call askUserQuestion to pick runtime or interpreter path",
    } satisfies Partial<CodeReplResult>);
  }

  const workdir = getWorkdir();
  const persist = input.persist === true;
  let absolutePath: string;
  let relativePath: string;
  let cleanup = false;

  try {
    if (code && filePath) {
      runWrite(filePath, code);
      absolutePath = safePath(filePath);
      relativePath = filePath;
    } else if (filePath) {
      absolutePath = safePath(filePath);
      relativePath = filePath;
      if (!fs.existsSync(absolutePath)) {
        return JSON.stringify({
          runtime: resolvedRuntimeId,
          error: `file not found: ${filePath}`,
        } satisfies Partial<CodeReplResult>);
      }
    } else {
      const ext = pickExtension(runtime);
      const tmpDir = path.join(workdir, DATA_DIR, "tmp");
      fs.mkdirSync(tmpDir, { recursive: true });
      const fileName = `${crypto.randomUUID()}${ext}`;
      absolutePath = path.join(tmpDir, fileName);
      relativePath = path.relative(workdir, absolutePath);
      fs.writeFileSync(absolutePath, code!, "utf8");
      cleanup = !persist;
    }

    const timeoutMs =
      input.timeout_ms !== undefined && Number.isFinite(Number(input.timeout_ms))
        ? Number(input.timeout_ms)
        : codeReplTimeoutMs();

    const args = Array.isArray(input.args) ? input.args.map(String) : [];
    const ctx: ExecuteContext = {
      filePath: absolutePath,
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
        executed_path: relativePath,
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
            executed_path: relativePath,
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
          executed_path: relativePath,
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
        executed_path: relativePath,
        error: String(error),
      } satisfies CodeReplResult);
    }
  } catch (error) {
    return JSON.stringify({
      runtime: resolvedRuntimeId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies Partial<CodeReplResult>);
  } finally {
    if (cleanup) {
      try {
        fs.unlinkSync(absolutePath!);
      } catch {
        // ignore cleanup errors
      }
    }
  }
}

function localBin(name: string): string | undefined {
  const candidate = path.join(process.cwd(), "node_modules", ".bin", name);
  return fs.existsSync(candidate) ? candidate : undefined;
}

export const tsxRuntime: CodeRuntime = {
  id: "tsx",
  extensions: [".ts", ".tsx"],
  description: "TypeScript via tsx — Oculeau stack, quick scripts",
  async detect() {
    const cmd = localBin("tsx") ?? (await resolveCommand("tsx")) ?? "tsx";
    const probe = await probeCommand(cmd, ["--version"]);
    return {
      available: probe.ok,
      version: probe.version,
      command: cmd,
      error: probe.error,
    };
  },
  buildCommand(ctx) {
    const cmd = localBin("tsx") ?? "tsx";
    return { cmd, args: [ctx.filePath, ...ctx.args] };
  },
};

export const nodeRuntime: CodeRuntime = {
  id: "node",
  extensions: [".js", ".mjs", ".cjs"],
  description: "Node.js — plain JavaScript files",
  async detect() {
    const cmd = (await resolveCommand("node")) ?? "node";
    const probe = await probeCommand(cmd, ["--version"]);
    return {
      available: probe.ok,
      version: probe.version,
      command: cmd,
      error: probe.error,
    };
  },
  buildCommand(ctx) {
    return { cmd: "node", args: [ctx.filePath, ...ctx.args] };
  },
};

export const pythonRuntime: CodeRuntime = {
  id: "python",
  extensions: [".py"],
  description: "Python — ML, training scripts, data science",
  async detect() {
    const env = buildRuntimeEnv();
    const configured = pythonPath();
    const candidates = configured
      ? [configured]
      : [path.join(venvPath() ?? "", "bin", "python"), "python3", "python"].filter(Boolean);

    for (const candidate of candidates) {
      const cmd =
        candidate.includes("/") || candidate.includes("\\")
          ? path.resolve(candidate)
          : ((await resolveCommand(candidate)) ?? candidate);
      const probe = await probeCommand(cmd, ["--version"], env);
      if (probe.ok) {
        return {
          available: true,
          version: probe.version,
          command: cmd,
        };
      }
    }

    return {
      available: false,
      error: "python interpreter not found (set OCULEAU_PYTHON or OCULEAU_VENV)",
    };
  },
  buildCommand(ctx) {
    const configured = pythonPath();
    const cmd = configured ?? "python3";
    return { cmd, args: [ctx.filePath, ...ctx.args] };
  },
};
