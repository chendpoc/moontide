import { clearSlots } from "./orchestrator.js";
import { registerContextPlugin } from "../plugins/context.js";
import { registerTracePlugin } from "../plugins/trace/register.js";

export function registerAllPlugins(): void {
  clearSlots();
  registerContextPlugin();
  registerTracePlugin();
}
