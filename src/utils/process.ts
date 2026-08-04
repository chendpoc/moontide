import { exec, execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface ProcessCollectOptions {
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessCollectResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function spawnCollect(
  command: string,
  args: string[],
  options: ProcessCollectOptions = {},
): Promise<ProcessCollectResult> {
  const cwd = options.cwd ?? process.cwd();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: options.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

export async function execFileCollect(
  command: string,
  args: string[],
  options: ProcessCollectOptions = {},
): Promise<ProcessCollectResult & { error?: Error }> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      encoding: "utf8",
      env: options.env,
    });
    return {
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? ""),
      code: 0,
    };
  } catch (error) {
    if (error instanceof Error) {
      const execError = error as Error & {
        code?: number | string;
        stdout?: string;
        stderr?: string;
      };
      return {
        stdout: String(execError.stdout ?? ""),
        stderr: String(execError.stderr ?? ""),
        code: typeof execError.code === "number" ? execError.code : 1,
        error: execError,
      };
    }
    throw error;
  }
}

export interface ExecShellOptions extends ProcessCollectOptions {
  shell?: string;
}

export async function execShell(
  command: string,
  options: ExecShellOptions = {},
): Promise<ProcessCollectResult & { error?: Error }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: options.cwd,
      timeout: options.timeout,
      maxBuffer: options.maxBuffer,
      encoding: "utf8",
      shell: options.shell ?? "/bin/bash",
      env: options.env,
    });
    return {
      stdout: String(stdout ?? ""),
      stderr: String(stderr ?? ""),
      code: 0,
    };
  } catch (error) {
    if (error instanceof Error) {
      const execError = error as Error & {
        killed?: boolean;
        signal?: string;
        stdout?: string;
        stderr?: string;
      };
      return {
        stdout: String(execError.stdout ?? ""),
        stderr: String(execError.stderr ?? ""),
        code: 1,
        error: execError,
      };
    }
    throw error;
  }
}
