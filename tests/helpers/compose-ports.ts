import { composePortsFromConfig } from "../../packages/agent/src/agent/compose-options.js";

/** Merge product-layer compose ports into test composeContext input. */
export function withComposePorts<T extends object>(input: T) {
  return { ...input, ...composePortsFromConfig() };
}
