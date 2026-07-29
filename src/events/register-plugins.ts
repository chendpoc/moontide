import { clearSlots } from "./orchestrator.js";
import { registerContextPlugin } from "../extensions/context/plugin.js";
import { registerTracePlugin } from "../extensions/trace/register.js";

export function registerAllPlugins(): void {
  clearSlots();
  registerContextPlugin();
  registerTracePlugin();
}
