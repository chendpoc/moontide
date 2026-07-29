import { codeReplDefaultRuntime } from "../../config.js";
import { getRuntime } from "./registry.js";
import { cleanupScript, prepareScript, runPreparedScript } from "./runner.js";
import type { CodeReplInput, CodeReplResult } from "./types.js";

export async function executeCodeRepl(input: CodeReplInput): Promise<string> {
  const code = input.code !== undefined ? String(input.code) : undefined;
  const filePath = input.path !== undefined ? String(input.path) : undefined;

  if (!code && !filePath) {
    return JSON.stringify({
      error: "Either code or path is required",
    } satisfies Partial<CodeReplResult>);
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

  let script: ReturnType<typeof prepareScript>;
  try {
    script = prepareScript(input, runtime);
    if ("error" in script) {
      return JSON.stringify({
        runtime: resolvedRuntimeId,
        error: script.error,
      } satisfies Partial<CodeReplResult>);
    }
  } catch (error) {
    return JSON.stringify({
      runtime: resolvedRuntimeId,
      error: error instanceof Error ? error.message : String(error),
    } satisfies Partial<CodeReplResult>);
  }

  try {
    return await runPreparedScript(runtime, resolvedRuntimeId, script, input);
  } finally {
    cleanupScript(script);
  }
}
