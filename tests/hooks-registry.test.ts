import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComposedContext } from "@moontide/context-composer";
import { RunObserverError } from "../packages/agent/src/agent/run-observers/index.js";
import type { SessionItem } from "@moontide/session";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";

function userItem(): SessionItem {
  return {
    kind: "user_message",
    id: "item-1",
    sessionId: "sess-1",
    turn: 1,
    at: "2026-08-04T00:00:00.000Z",
    text: "hello",
  };
}

function composedFixture(): ComposedContext {
  return {
    request: {
      system: "system",
      messages: [],
      tools: [],
    },
    manifest: {
      turn: 1,
      toolDefinitionNames: [],
      sessionId: "sess-1",
    },
  };
}

describe("sidecar run observer registry", () => {
  beforeEach(() => {
    installTestRuntime();
  });

  afterEach(() => {
    clearTestRuntime();
  });

  it("dispatches session items to registered handlers", async () => {
    const runtime = installTestRuntime();
    const onItem = vi.fn();
    runtime.observerRegistry.sidecar().on("sessionItem", "memory", ({ item }) => {
      onItem(item);
    });

    await runtime.observers.dispatch("sessionItem", { item: userItem() });

    expect(onItem).toHaveBeenCalledWith(userItem());
  });

  it("continues on fail-open handler errors", async () => {
    const runtime = installTestRuntime();
    const second = vi.fn();
    runtime.observerRegistry.sidecar().on(
      "sessionItem",
      "noisy",
      () => {
        throw new Error("derive blew up");
      },
      { errorPolicy: "fail-open" },
    );
    runtime.observerRegistry.sidecar().on("sessionItem", "memory", ({ item }) => {
      second(item);
    });

    await expect(
      runtime.observers.dispatch("sessionItem", { item: userItem() }),
    ).resolves.toBeUndefined();
    expect(second).toHaveBeenCalledOnce();
  });

  it("throws on fail-closed handler errors", async () => {
    const runtime = installTestRuntime();
    runtime.observerRegistry.sidecar().on(
      "sessionItem",
      "file",
      () => {
        throw new Error("disk full");
      },
      { errorPolicy: "fail-closed" },
    );

    await expect(
      runtime.observers.dispatch("sessionItem", { item: userItem() }),
    ).rejects.toBeInstanceOf(RunObserverError);
  });

  it("dispose removes a handler", async () => {
    const runtime = installTestRuntime();
    const onItem = vi.fn();
    const dispose = runtime.observerRegistry.sidecar().on("sessionItem", "memory", ({ item }) => {
      onItem(item);
    });
    dispose();

    await runtime.observers.dispatch("sessionItem", { item: userItem() });

    expect(onItem).not.toHaveBeenCalled();
  });

  it("clear removes all handlers", async () => {
    const runtime = installTestRuntime();
    const onItem = vi.fn();
    const onCompose = vi.fn();
    runtime.observerRegistry.sidecar().on("sessionItem", "memory", ({ item }) => {
      onItem(item);
    });
    runtime.observerRegistry.sidecar().on("composeComplete", "metrics", () => {
      onCompose();
    });
    runtime.observerRegistry.clear();

    await runtime.observers.dispatch("sessionItem", { item: userItem() });
    await runtime.observers.dispatch("composeComplete", { composed: composedFixture() });

    expect(onItem).not.toHaveBeenCalled();
    expect(onCompose).not.toHaveBeenCalled();
  });
});

describe("composeComplete observers", () => {
  beforeEach(() => {
    installTestRuntime();
  });

  afterEach(() => {
    clearTestRuntime();
  });

  it("notifies compose handlers after compose", async () => {
    const runtime = installTestRuntime();
    const onComposeComplete = vi.fn();
    runtime.observerRegistry.sidecar().on("composeComplete", "metrics", ({ composed }) => {
      onComposeComplete(composed);
    });
    const composed = composedFixture();

    await runtime.observers.dispatch("composeComplete", { composed });

    expect(onComposeComplete).toHaveBeenCalledWith(composed);
  });
});
