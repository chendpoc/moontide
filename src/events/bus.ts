import { finalizeEvent } from "./run.js";
import type { AgentEvent, EventDraft } from "./types.js";

export type EventListener = (event: AgentEvent) => void;

export interface EventSink {
  handle(event: AgentEvent): void;
  close?(): void;
}

const listeners = new Set<EventListener>();
let sinks: EventSink[] = [];
let testCollector: AgentEvent[] | null = null;

export function emit(event: AgentEvent): void {
  if (testCollector) {
    testCollector.push(event);
  }
  for (const sink of sinks) {
    sink.handle(event);
  }
  for (const listener of listeners) {
    listener(event);
  }
}

export function emitDraft(draft: EventDraft): AgentEvent {
  const event = finalizeEvent(draft);
  emit(event);
  return event;
}

export function subscribe(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSinks(next: EventSink[]): void {
  for (const sink of sinks) {
    sink.close?.();
  }
  sinks = next;
}

export function getSinks(): readonly EventSink[] {
  return sinks;
}

export function enableTestCollector(): void {
  testCollector = [];
}

export function disableTestCollector(): void {
  testCollector = null;
}

export function getCollectedEvents(): AgentEvent[] {
  return testCollector ?? [];
}

/** Test helper — collects events via subscribe. */
export function collectEvents(): EventListener & { events: AgentEvent[]; clear(): void } {
  const bucket: AgentEvent[] = [];
  const listener = ((event: AgentEvent) => {
    bucket.push(event);
  }) as EventListener & { events: AgentEvent[]; clear(): void };
  listener.events = bucket;
  listener.clear = () => {
    bucket.length = 0;
  };
  subscribe(listener);
  return listener;
}
