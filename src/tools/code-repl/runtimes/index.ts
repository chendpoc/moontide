import { registerRuntime } from "../registry.js";
import { nodeRuntime, pythonRuntime, tsxRuntime } from "../executor.js";

export function registerBuiltinRuntimes(): void {
  registerRuntime(tsxRuntime);
  registerRuntime(nodeRuntime);
  registerRuntime(pythonRuntime);
}
