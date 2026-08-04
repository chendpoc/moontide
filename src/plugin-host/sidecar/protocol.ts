import type { HookPhase } from "../../agent/hooks/phases.js";
import type { SidecarHookSpec, SidecarToolSpec } from "../types.js";

export type HostToSidecarMessage =
  | { type: "init"; pluginId: string; workdir: string }
  | { type: "hook"; id: string; phase: HookPhase; name: string; ctx: unknown }
  | { type: "tool"; id: string; name: string; input: Record<string, unknown> }
  | { type: "shutdown" };

export type SidecarToHostMessage =
  | {
      type: "ready";
      pluginId: string;
      hooks: SidecarHookSpec[];
      tools: SidecarToolSpec[];
    }
  | { type: "hook_result"; id: string; result?: unknown }
  | { type: "tool_result"; id: string; output: string }
  | { type: "error"; id?: string; message: string };

export function encodeSidecarMessage(message: HostToSidecarMessage | SidecarToHostMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function parseSidecarMessage(line: string): HostToSidecarMessage | SidecarToHostMessage {
  return JSON.parse(line) as HostToSidecarMessage | SidecarToHostMessage;
}
