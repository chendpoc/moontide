import fs from "node:fs";

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { emitDraft } from "./events/bus.js";
import { AUDIT_LOG_PATH } from "./config.js";
import { checkPermission } from "./permissions.js";

export type HookFn = (context: Record<string, unknown>) => string | null | void;

const HOOKS: Record<string, HookFn[]> = {
  UserPromptSubmit: [],
  PreToolUse: [],
  PostToolUse: [],
  Stop: [],
};

export function register(event: string, callback: HookFn): void {
  HOOKS[event] ??= [];
  HOOKS[event].push(callback);
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

function permissionHook(context: Record<string, unknown>): string | null {
  const toolName = String(context.tool_name ?? "");
  const toolInput = (context.tool_input ?? {}) as Record<string, unknown>;
  const decision = checkPermission(toolName, toolInput);
  if (decision === "deny") {
    return `Permission denied: ${toolName}`;
  }
  return null;
}

export function auditToolUse(context: Record<string, unknown>): void {
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

export function setupDefaultHooks(): void {
  HOOKS.PreToolUse = [];
  register("PreToolUse", permissionHook);
}

export type { MessageParam };
