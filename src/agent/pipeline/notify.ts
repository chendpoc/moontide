import { emitDraft } from "../../log/bus.js";
import { getRunId } from "../../log/run.js";
import type { EventDraft } from "../../log/types.js";
import { getPlugins } from "./registry.js";
import type {
  LLMCallRecord,
  PluginEvents,
  PluginFailureRecord,
  PluginHook,
  ToolUseRecord,
} from "./types.js";

function isPluginHookResult(value: PluginEvents): value is Extract<PluginEvents, { modelAppend?: string }> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && !("channel" in value)
    && ("events" in value || "modelAppend" in value)
  );
}

function parsePluginEvents(value: PluginEvents): { drafts: EventDraft[]; modelAppend?: string } {
  if (!value) {
    return { drafts: [] };
  }
  if (Array.isArray(value)) {
    return { drafts: value };
  }
  if (isPluginHookResult(value)) {
    const nested = value.events ? parsePluginEvents(value.events) : { drafts: [] };
    return {
      drafts: nested.drafts,
      modelAppend: value.modelAppend,
    };
  }
  return { drafts: [value] };
}

function toPluginFailureRecord(
  plugin: string,
  hook: PluginHook,
  record: LLMCallRecord | ToolUseRecord,
  err: unknown,
): PluginFailureRecord {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  return {
    plugin,
    hook,
    turn: record.turn,
    runId: getRunId(),
    toolName: "toolName" in record ? record.toolName : undefined,
    toolUseId: "toolUseId" in record ? record.toolUseId : undefined,
    message,
    stack,
  };
}

export function logPluginFailure(failure: PluginFailureRecord): void {
  const location =
    failure.toolName !== undefined
      ? ` turn=${failure.turn} tool=${failure.toolName}`
      : ` turn=${failure.turn}`;
  console.error(`[plugin:${failure.plugin}] ${failure.hook} failed:${location} ${failure.message}`);
  if (failure.stack) {
    console.error(failure.stack);
  }
}

function emitPluginError(failure: PluginFailureRecord): void {
  emitDraft({
    turn: failure.turn,
    phase: failure.hook === "onLLMCall" ? "post_llm" : "post_tool",
    channel: "audit",
    kind: "plugin_error",
    payload: {
      plugin: failure.plugin,
      hook: failure.hook,
      runId: failure.runId,
      toolName: failure.toolName,
      toolUseId: failure.toolUseId,
      message: failure.message,
      stack: failure.stack,
    },
    preview: `${failure.plugin}/${failure.hook}`,
  });
}

export async function notifyPlugins(
  hook: PluginHook,
  record: LLMCallRecord | ToolUseRecord,
): Promise<string[]> {
  const modelAppends: string[] = [];

  for (const plugin of getPlugins()) {
    const fn = plugin[hook];
    if (!fn) {
      continue;
    }
    try {
      const result =
        hook === "onLLMCall"
          ? await plugin.onLLMCall!(record as LLMCallRecord)
          : await plugin.onToolUse!(record as ToolUseRecord);
      const parsed = parsePluginEvents(result);
      for (const draft of parsed.drafts) {
        emitDraft({
          ...draft,
          turn: draft.turn ?? record.turn,
        });
      }
      if (hook === "onToolUse" && parsed.modelAppend) {
        modelAppends.push(parsed.modelAppend);
      }
    } catch (err) {
      const failure = toPluginFailureRecord(plugin.name, hook, record, err);
      logPluginFailure(failure);
      emitPluginError(failure);
    }
  }

  return modelAppends;
}
