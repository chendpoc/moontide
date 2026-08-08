export interface RuntimeProbe {
  available: boolean;
  version?: string;
  command?: string;
  error?: string;
}

export interface ExecuteContext {
  filePath: string;
  workdir: string;
  args: string[];
  timeoutMs: number;
  env: Record<string, string>;
}

export interface CodeRuntime {
  id: string;
  extensions: string[];
  description: string;
  detect(): Promise<RuntimeProbe>;
  buildCommand(ctx: ExecuteContext): { cmd: string; args: string[] };
}

export interface CodeReplInput {
  runtime?: string;
  code?: string;
  path?: string;
  template?: string;
  vars?: Record<string, unknown>;
  args?: string[];
  timeout_ms?: number;
  persist?: boolean;
}

export interface CodeReplResult {
  runtime: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  executed_path: string;
  truncated?: boolean;
  error?: string;
  suggestion?: string;
  template?: string;
  resolved_vars?: Record<string, string | number | boolean>;
}

export const OUTPUT_LIMIT = 50_000;
