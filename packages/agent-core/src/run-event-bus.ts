import type { RunEvent } from "@moontide/run-protocol";

export type RunEventListener = (event: RunEvent) => void | Promise<void>;

export interface RunEventOutput {
  handle(event: RunEvent): void;
  close?(): void;
}

export interface RunEventBus {
  publish(event: RunEvent): void;
  subscribe(listener: RunEventListener): () => void;
  setOutputs(outputs: RunEventOutput[]): void;
}

export function createRunEventBus(): RunEventBus & { events: RunEvent[] } {
  const events: RunEvent[] = [];
  const listeners = new Set<RunEventListener>();
  let outputs: RunEventOutput[] = [];

  const eventBus: RunEventBus & { events: RunEvent[] } = {
    events,
    publish(event: RunEvent) {
      events.push(event);
      for (const output of outputs) {
        output.handle(event);
      }
      for (const listener of listeners) {
        void listener(event);
      }
    },
    subscribe(listener: RunEventListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setOutputs(next: RunEventOutput[]) {
      for (const output of outputs) {
        output.close?.();
      }
      outputs = next;
    },
  };

  return eventBus;
}
