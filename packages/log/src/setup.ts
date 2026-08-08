import { setOutputs } from "./event-hub.js";
import { JsonlWriter } from "./outputs/jsonl.js";

export interface ConfigureJsonlOptions {
  workdir?: string;
}

/** Connect Agent Event JSONL output only (no terminal renderer). */
export function configureJsonlOutput(options: ConfigureJsonlOptions = {}): void {
  setOutputs([new JsonlWriter(options.workdir ? { workdir: options.workdir } : {})]);
}

export function resetEventPlatform(): void {
  setOutputs([]);
}
