import type {
  HostToSidecarMessage,
  SidecarToHostMessage,
} from "./protocol.js";

type HostMessageHandler<T extends HostToSidecarMessage["type"]> = (
  message: Extract<HostToSidecarMessage, { type: T }>,
) => void | Promise<void>;

export function createHostMessageHandlers(handlers: {
  [T in HostToSidecarMessage["type"]]: HostMessageHandler<T>;
}): {
  [T in HostToSidecarMessage["type"]]: HostMessageHandler<T>;
} {
  return handlers;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export function resolvePendingResponse(
  pending: Map<string, PendingRequest>,
  message: SidecarToHostMessage,
): boolean {
  if (message.type === "hook_result" || message.type === "tool_result") {
    const entry = pending.get(message.id);
    if (!entry) {
      return false;
    }
    pending.delete(message.id);
    entry.resolve(message.type === "tool_result" ? message.output : message.result);
    return true;
  }
  if (message.type === "error" && message.id) {
    const entry = pending.get(message.id);
    if (!entry) {
      return false;
    }
    pending.delete(message.id);
    entry.reject(new Error(message.message));
    return true;
  }
  return false;
}

export function createSidecarResponseHandlers(handlers: {
  ready: (message: Extract<SidecarToHostMessage, { type: "ready" }>) => void;
  resolvePending: (message: SidecarToHostMessage) => boolean;
}): Partial<Record<SidecarToHostMessage["type"], (message: SidecarToHostMessage) => void>> {
  return {
    ready: (message) => {
      if (message.type === "ready") {
        handlers.ready(message);
      }
    },
    hook_result: handlers.resolvePending,
    tool_result: handlers.resolvePending,
    error: handlers.resolvePending,
  };
}

export function dispatchHostMessage(
  handlers: ReturnType<typeof createHostMessageHandlers>,
  message: HostToSidecarMessage,
): void | Promise<void> {
  switch (message.type) {
    case "init":
      return handlers.init(message);
    case "hook":
      return handlers.hook(message);
    case "tool":
      return handlers.tool(message);
    case "shutdown":
      return handlers.shutdown(message);
  }
}

export function dispatchSidecarResponse(
  handlers: Partial<Record<SidecarToHostMessage["type"], (message: SidecarToHostMessage) => void>>,
  message: SidecarToHostMessage,
): void {
  handlers[message.type]?.(message);
}
