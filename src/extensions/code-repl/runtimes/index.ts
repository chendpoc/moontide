import { registerRuntime } from "../registry.js";
import { nodeRuntime } from "./node.js";
import { pythonRuntime } from "./python.js";
import { tsxRuntime } from "./tsx.js";

export function registerBuiltinRuntimes(): void {
  registerRuntime(tsxRuntime);
  registerRuntime(nodeRuntime);
  registerRuntime(pythonRuntime);
}
