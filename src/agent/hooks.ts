import fs from "node:fs";

import { AUDIT_LOG_PATH } from "../config.js";
import { emitDraft } from "../events/bus.js";
import { checkPermission } from "../permission/index.js";

type HookFn = (context: Record<string, unknown>) => string | null | void;

const HOOKS: Record<string, HookFn[]> = {
  PreToolUse: [],
  PostToolUse: [],
};

function auditToolUse(context: Record<string, unknown>): void {
  const toolName = String(context.tool_name ?? "");
  const toolInput = context.tool_input ?? {};
  const line = `${new Date().toISOString()}\t${toolName}\t${JSON.stringify(toolInput)}\n`;
  fs.appendFileSync(AUDIT_LOG_PATH, line, "utf8");

  emitDraft({
    turn: Number(context.turn ?? 0),
    phase: "post_tool",
    channel: "audit",
    kind: "tool_use",
    payload: { toolName, toolInput },
    preview: toolName,
  });
}

function defaultPreToolUse(context: Record<string, unknown>): string | null {
  const toolName = String(context.tool_name ?? "");
  const toolInput = (context.tool_input ?? {}) as Record<string, unknown>;
  if (checkPermission(toolName, toolInput) === "deny") {
    return `Permission denied: ${toolName}`;
  }
  return null;
}

function defaultPostToolUse(context: Record<string, unknown>): void {
  auditToolUse(context);
}

export function setupDefaultHooks(): void {
  HOOKS.PreToolUse = [defaultPreToolUse];
  HOOKS.PostToolUse = [defaultPostToolUse];
}

export function runHooks(event: string, context: Record<string, unknown>): string | null {
  for (const callback of HOOKS[event] ?? []) {
    const result = callback(context);
    if (result != null) {
      return String(result);
    }
  }
  return null;
}
