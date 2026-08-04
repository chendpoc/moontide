import { describe, expect, it, vi } from "vitest";

import type { ComposedContext } from "../src/context/composer/types.js";
import {
  HookObserverError,
  hookDispatcher,
  resetSidecarHooks,
  sidecarHooks,
} from "../src/agent/hooks/index.js";
import type { SessionItem } from "../src/session/types.js";

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

describe("sidecar hook registry", () => {
  it("dispatches session items to registered handlers", async () => {
    resetSidecarHooks();
    const onItem = vi.fn();
    sidecarHooks().on("sessionItem", "memory", ({ item }) => {
      onItem(item);
    });

    await hookDispatcher.dispatch("sessionItem", { item: userItem() });

    expect(onItem).toHaveBeenCalledWith(userItem());
  });

  it("continues on fail-open handler errors", async () => {
    resetSidecarHooks();
    const second = vi.fn();
    sidecarHooks().on(
      "sessionItem",
      "noisy",
      () => {
        throw new Error("derive blew up");
      },
      { errorPolicy: "fail-open" },
    );
    sidecarHooks().on("sessionItem", "memory", ({ item }) => {
      second(item);
    });

    await expect(
      hookDispatcher.dispatch("sessionItem", { item: userItem() }),
    ).resolves.toBeUndefined();
    expect(second).toHaveBeenCalledOnce();
  });

  it("throws on fail-closed handler errors", async () => {
    resetSidecarHooks();
    sidecarHooks().on(
      "sessionItem",
      "file",
      () => {
        throw new Error("disk full");
      },
      { errorPolicy: "fail-closed" },
    );

    await expect(
      hookDispatcher.dispatch("sessionItem", { item: userItem() }),
    ).rejects.toBeInstanceOf(HookObserverError);
  });

  it("dispose removes a handler", async () => {
    resetSidecarHooks();
    const onItem = vi.fn();
    const dispose = sidecarHooks().on("sessionItem", "memory", ({ item }) => {
      onItem(item);
    });
    dispose();

    await hookDispatcher.dispatch("sessionItem", { item: userItem() });

    expect(onItem).not.toHaveBeenCalled();
  });

  it("clear removes all handlers", async () => {
    resetSidecarHooks();
    const onItem = vi.fn();
    const onCompose = vi.fn();
    sidecarHooks().on("sessionItem", "memory", ({ item }) => {
      onItem(item);
    });
    sidecarHooks().on("composeComplete", "metrics", () => {
      onCompose();
    });
    sidecarHooks().clear();

    await hookDispatcher.dispatch("sessionItem", { item: userItem() });
    await hookDispatcher.dispatch("composeComplete", { composed: composedFixture() });

    expect(onItem).not.toHaveBeenCalled();
    expect(onCompose).not.toHaveBeenCalled();
  });
});

describe("composeComplete hooks", () => {
  it("notifies compose handlers after compose", async () => {
    resetSidecarHooks();
    const onComposeComplete = vi.fn();
    sidecarHooks().on("composeComplete", "metrics", ({ composed }) => {
      onComposeComplete(composed);
    });
    const composed = composedFixture();

    await hookDispatcher.dispatch("composeComplete", { composed });

    expect(onComposeComplete).toHaveBeenCalledWith(composed);
  });
});
