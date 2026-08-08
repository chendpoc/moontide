import { toMessage } from "@moontide/shared/errors/normalize.js";
import { getToolsProductConfig } from "../../ports/product-config.js";
import { getRuntime } from "./registry.js";
import { cleanupScript, prepareScript, runPreparedScript } from "./runner.js";
import { expandTemplate } from "./templates/expand.js";
import type { CodeReplInput, CodeReplResult } from "./types.js";

export async function executeCodeRepl(input: CodeReplInput, workdir: string): Promise<string> {
  let effectiveInput = input;
  let templateMeta: { template: string; resolved_vars: Record<string, string | number | boolean> } | undefined;

  if (input.template !== undefined) {
    if (input.code !== undefined) {
      return JSON.stringify({
        error: "Cannot use both template and code",
        template: String(input.template),
      } satisfies Partial<CodeReplResult>);
    }
    if (input.path !== undefined) {
      return JSON.stringify({
        error: "Cannot use both template and path",
        template: String(input.template),
      } satisfies Partial<CodeReplResult>);
    }

    const expanded = expandTemplate(String(input.template), input.vars ?? {}, workdir);
    if ("error" in expanded) {
      return JSON.stringify(expanded);
    }

    templateMeta = {
      template: String(input.template),
      resolved_vars: expanded.resolvedVars,
    };
    effectiveInput = {
      ...input,
      runtime: expanded.runtime,
      code: expanded.code,
      path: undefined,
    };
  }

  const code = effectiveInput.code !== undefined ? String(effectiveInput.code) : undefined;
  const filePath = effectiveInput.path !== undefined ? String(effectiveInput.path) : undefined;

  if (!code && !filePath) {
    return JSON.stringify({
      error: "Either code, path, or template is required",
    } satisfies Partial<CodeReplResult>);
  }

  const runtimeId = effectiveInput.runtime?.trim() || undefined;
  const resolvedRuntimeId = runtimeId || getToolsProductConfig().codeReplDefaultRuntime();
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
    script = prepareScript(effectiveInput, runtime, workdir);
    if ("error" in script) {
      return JSON.stringify({
        runtime: resolvedRuntimeId,
        error: script.error,
      } satisfies Partial<CodeReplResult>);
    }
  } catch (error) {
    return JSON.stringify({
      runtime: resolvedRuntimeId,
      error: toMessage(error),
    } satisfies Partial<CodeReplResult>);
  }

  try {
    const raw = await runPreparedScript(runtime, resolvedRuntimeId, script, effectiveInput, workdir);
    if (!templateMeta) {
      return raw;
    }
    const result = JSON.parse(raw) as CodeReplResult;
    return JSON.stringify({ ...result, ...templateMeta });
  } finally {
    cleanupScript(script);
  }
}
