import fs from "node:fs";

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages/messages.js";

import { checkPermission } from "./permissions.js";

export type HookFn = (context: Record<string, unknown>) => string | null | void;

const HOOKS: Record<string, HookFn[]> = {
  UserPromptSubmit: [],
  PreToolUse: [],
  PostToolUse: [],
  Stop: [],
  PreLLM: [],
  PostLLM: [],
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
  if (decision === "ask") {
    return `Permission required: ${toolName} needs user approval`;
  }
  return null;
}

function auditHook(context: Record<string, unknown>): void {
  const toolName = String(context.tool_name ?? "");
  const toolInput = JSON.stringify(context.tool_input ?? {});
  const line = `${new Date().toISOString()}\t${toolName}\t${toolInput}\n`;
  fs.appendFileSync(".oculus-audit.log", line, "utf8");
}

function preLlmHook(_context: Record<string, unknown>): void {
  // placeholder for prompt snapshot / context injection
}

function postLlmHook(_context: Record<string, unknown>): void {
  // placeholder for metrics / logging
}

export function setupDefaultHooks(): void {
  HOOKS.PreToolUse = [];
  register("PreToolUse", auditHook);
  register("PreToolUse", permissionHook);
  register("PreLLM", preLlmHook);
  register("PostLLM", postLlmHook);
}

export type { MessageParam };
