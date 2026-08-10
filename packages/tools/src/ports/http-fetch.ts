import type { HttpFetchInput } from "../builtins/network/http-fetch.js";

export type HttpFetchExecutor = (input: HttpFetchInput) => Promise<string>;

let executorOverride: HttpFetchExecutor | undefined;

export function setHttpFetchExecutor(next: HttpFetchExecutor | undefined): void {
  executorOverride = next;
}

export function getHttpFetchExecutor(): HttpFetchExecutor | undefined {
  return executorOverride;
}

export function resetHttpFetchExecutor(): void {
  executorOverride = undefined;
}
