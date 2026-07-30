import { auditPlugin } from "../../extensions/audit/plugin.js";
import { contextPlugin } from "../../extensions/context/plugin.js";
import { tracePlugin } from "../../extensions/trace/register.js";
import type { AgentPlugin } from "./types.js";

export const DEFAULT_PLUGINS: AgentPlugin[] = [
  tracePlugin(),
  contextPlugin(),
  auditPlugin(),
];

let plugins: AgentPlugin[] = [...DEFAULT_PLUGINS];

export function getPlugins(): readonly AgentPlugin[] {
  return plugins;
}

export function resetPlugins(): void {
  plugins = [...DEFAULT_PLUGINS];
}

export function setPlugins(next: AgentPlugin[]){
  plugins = [...next];
}
