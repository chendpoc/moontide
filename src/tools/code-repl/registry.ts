import type { CodeRuntime, RuntimeProbe } from "./types.js";

const runtimes = new Map<string, CodeRuntime>();

export function registerRuntime(runtime: CodeRuntime): void {
  runtimes.set(runtime.id, runtime);
}

export function getRuntime(id: string): CodeRuntime | undefined {
  return runtimes.get(id);
}

export function listRuntimes(): CodeRuntime[] {
  return [...runtimes.values()];
}

export function buildRuntimeEnum(): string[] {
  return listRuntimes().map((rt) => rt.id);
}

export async function probeAll(): Promise<Record<string, RuntimeProbe>> {
  const results: Record<string, RuntimeProbe> = {};
  for (const rt of listRuntimes()) {
    results[rt.id] = await rt.detect();
  }
  return results;
}

export function runtimeDescriptions(): string {
  return listRuntimes()
    .map((rt) => `- ${rt.id}: ${rt.description}`)
    .join("\n");
}
