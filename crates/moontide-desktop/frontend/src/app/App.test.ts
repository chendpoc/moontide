// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App.svelte";
import {
  DesktopController,
  type DesktopBridge,
  type DesktopControllerPort,
  type DesktopViewState,
  type Unlisten,
} from "$lib/controller/index.js";
import type {
  DesktopProtocolEvent,
  DesktopResponse,
  DesktopSnapshot,
  ToolResult,
} from "$lib/protocol/index.js";
import { parseDesktopMessageEnvelope } from "$lib/protocol/index.js";
import { createRenderState, reduceEnvelope } from "$lib/projection/renderState.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

class FakeController implements DesktopControllerPort {
  state: DesktopViewState;
  readonly operations: string[] = [];
  starts = 0;
  disposals = 0;
  submitTurnHandler: (text: string) => Promise<DesktopResponse> = async () => ({
    kind: "turn_accepted",
    turn: 1,
  });
  newChatHandler: () => Promise<void> = async () => undefined;
  approveHandler: (approvalId: string) => Promise<DesktopResponse> = async (
    approvalId,
  ) => ({ kind: "approval_accepted", approval_id: approvalId });
  loadSessionHandler: (sessionId: string) => Promise<void> = async () => undefined;
  loadOlderHistoryHandler: () => Promise<void> = async () => undefined;
  readonly #subscribers = new Set<(state: DesktopViewState) => void>();

  constructor(state = readyView()) {
    this.state = state;
  }

  subscribe(subscriber: (state: DesktopViewState) => void): () => void {
    this.#subscribers.add(subscriber);
    subscriber(this.state);
    return () => this.#subscribers.delete(subscriber);
  }

  publish(): void {
    this.state = { ...this.state };
    for (const subscriber of this.#subscribers) {
      subscriber(this.state);
    }
  }

  async start(): Promise<void> {
    this.starts += 1;
  }

  async newChat(): Promise<void> {
    this.operations.push("newChat");
    await this.newChatHandler();
  }

  async loadSession(sessionId: string): Promise<void> {
    this.operations.push(`loadSession:${sessionId}`);
    await this.loadSessionHandler(sessionId);
  }

  async loadOlderHistory(): Promise<void> {
    this.operations.push("loadOlderHistory");
    await this.loadOlderHistoryHandler();
  }

  async retryRuntime(): Promise<void> {
    this.operations.push("retryRuntime");
  }

  async retryCatalog(): Promise<void> {
    this.operations.push("retryCatalog");
  }

  async submitTurn(text: string): Promise<DesktopResponse> {
    this.operations.push(`submitTurn:${text}`);
    return this.submitTurnHandler(text);
  }

  async cancelTurn(): Promise<DesktopResponse> {
    this.operations.push("cancelTurn");
    return { kind: "cancellation_accepted", turn: 1 };
  }

  async approve(approvalId: string): Promise<DesktopResponse> {
    this.operations.push(`approve:${approvalId}`);
    return this.approveHandler(approvalId);
  }

  async deny(approvalId: string, reason: string): Promise<DesktopResponse> {
    this.operations.push(`deny:${approvalId}:${reason}`);
    return { kind: "approval_accepted", approval_id: approvalId };
  }

  async dispose(): Promise<void> {
    this.disposals += 1;
  }
}

class IntegrationBridge implements DesktopBridge {
  createCalls = 0;
  submitCalls = 0;
  createSessionHandler: () => Promise<DesktopResponse> = async () => ({
    kind: "session_ready",
    connection_epoch: 1,
    snapshot: protocolSnapshot(),
  });
  #envelopeListener: ((payload: unknown) => void) | null = null;

  async listSessions(): Promise<DesktopResponse> {
    return {
      kind: "session_catalog_listed",
      connection_epoch: 1,
      rows: [],
    };
  }

  async newChat(): Promise<DesktopResponse> {
    return { kind: "generation_ready", connection_epoch: 2 };
  }

  async createSession(): Promise<DesktopResponse> {
    this.createCalls += 1;
    return this.createSessionHandler();
  }

  async startSession(): Promise<DesktopResponse> {
    return { kind: "session_ready", connection_epoch: 1, snapshot: protocolSnapshot() };
  }

  async loadSessionHistory(): Promise<DesktopResponse> {
    return {
      kind: "session_history_page",
      session_id: "session-1",
      items: [],
      oldest_turn: null,
      has_older: false,
    };
  }

  async submitTurn(): Promise<DesktopResponse> {
    this.submitCalls += 1;
    return { kind: "turn_accepted", turn: 0 };
  }

  async cancelTurn(): Promise<DesktopResponse> {
    return { kind: "cancellation_accepted", turn: 0 };
  }

  async approve(approvalId: string): Promise<DesktopResponse> {
    return { kind: "approval_accepted", approval_id: approvalId };
  }

  async deny(approvalId: string): Promise<DesktopResponse> {
    return { kind: "approval_accepted", approval_id: approvalId };
  }

  async snapshot(): Promise<DesktopResponse> {
    return {
      kind: "snapshot",
      connection_epoch: 1,
      snapshot: protocolSnapshot(1, "hello MoonTide"),
    };
  }

  async shutdown(): Promise<DesktopResponse> {
    return {
      kind: "shutdown_completed",
      report: {
        cancelled_turn: null,
        progress_flushed: true,
        diagnostic_log_flushed: true,
      },
    };
  }

  async listenEnvelope(listener: (payload: unknown) => void): Promise<Unlisten> {
    this.#envelopeListener = listener;
    return () => {
      this.#envelopeListener = null;
    };
  }

  async listenConnection(): Promise<Unlisten> {
    return () => undefined;
  }

  completeTurn(): void {
    this.#envelopeListener?.(wireEvent(1, { kind: "turn_completed", turn: 0 }));
  }
}

describe("App", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.colorScheme = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders protocol content as escaped text from RenderState", async () => {
    const state = readyView();
    state.render.messages = [
      { kind: "user", turn: 1, text: '<img src=x onerror="alert(1)">' },
      {
        kind: "assistant",
        turn: 1,
        blocks: [
          { kind: "thinking", thinking: "private chain" },
          { kind: "text", text: "visible answer" },
        ],
      },
    ];
    state.render.assistantDrafts["2:call-2"] = {
      turn: 2,
      step: 0,
      llmCallId: "call-2",
      updateIndex: 1,
      snapshot: {
        content: [{ kind: "text", text: "streaming answer" }],
        pending: { kind: "text", text: "…" },
        stop_reason: null,
        usage: null,
        model: null,
      },
    };
    state.render.notices.push({
      kind: "error",
      message: "provider unavailable",
      recoverable: true,
      errorKind: "provider",
    });

    const controller = new FakeController(state);
    render(App, { props: { controller } });

    expect(await screen.findByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("visible answer")).toBeInTheDocument();
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.getByText("private chain")).toBeInTheDocument();
    expect(screen.getByText("streaming answer")).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();
    expect(screen.getByText("provider unavailable")).toBeInTheDocument();
  });

  it("shows the provider error restored from a failed terminal snapshot", async () => {
    const state = readyView();
    const snapshot = protocolSnapshot(4, "hello");
    snapshot.state = {
      failed: {
        turn: 0,
        error: {
          kind: "provider",
          message: "HTTP 402 Payment Required: Insufficient Balance",
          recoverable: true,
        },
      },
    };
    state.render = reduceEnvelope(
      createRenderState(),
      parseDesktopMessageEnvelope({
        protocol_version: 1,
        connection_epoch: 1,
        request_id: "terminal-refresh",
        seq: null,
        payload: {
          kind: "response",
          response: { kind: "snapshot", connection_epoch: 1, snapshot },
        },
      }),
    ).state;

    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByText("Reply didn't finish")).toBeInTheDocument();
    expect(
      screen.getByText("HTTP 402 Payment Required: Insufficient Balance"),
    ).toBeInTheDocument();
  });

  it("renders Loaded user and assistant geometry with local Copy actions", async () => {
    const state = readyView();
    state.render.messages = [
      { kind: "user", turn: 1, text: "A compact prompt" },
      {
        kind: "assistant",
        turn: 1,
        blocks: [{ kind: "text", text: "A plain long-form response" }],
      },
    ];
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    const user = await screen.findByText("A compact prompt");
    const assistant = screen.getByText("A plain long-form response");
    expect(user.closest('[data-message-kind="user"]')).toBeInTheDocument();
    expect(assistant.closest('[data-message-kind="assistant"]')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Copy user message" }));
    await fireEvent.click(screen.getByRole("button", { name: "Copy assistant message" }));
    expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(1, "A compact prompt");
    expect(navigator.clipboard.writeText).toHaveBeenNthCalledWith(
      2,
      "A plain long-form response",
    );
  });

  it("renders one Tool block per identity and keeps all terminal outcomes distinct", async () => {
    const state = readyView();
    const statuses: ToolResult["status"][] = [
      "succeeded",
      { failed: { retryable: false } },
      "invalid_arguments",
      "unknown_tool",
      "denied",
      { cancelled: { reason: "user" } },
      "outcome_unknown",
    ];
    statuses.forEach((status, index) => {
      const call = {
        tool_use_id: `tool-${index}`,
        name: `tool_${index}`,
        input: { index },
      };
      state.render.messages.push({ kind: "tool_call", turn: 1, call });
      state.render.messages.push({
        kind: "tool_result",
        turn: 1,
        result: {
          tool_use_id: call.tool_use_id,
          name: call.name,
          status,
          content: { text: `result-${index}` },
        },
      });
    });
    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Invalid arguments")).toBeInTheDocument();
    expect(screen.getByText("Unknown tool")).toBeInTheDocument();
    expect(screen.getByText("Denied")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Execution outcome unknown")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-tool-id]")).toHaveLength(statuses.length);
  });

  // A draft updates and finalizes under one assistant identity; its streaming announcement stays
  // outside visual flow so finalization cannot shift the message body.
  it("replaces one streaming assistant block and does not duplicate it on finalization", async () => {
    const state = readyView();
    state.render.assistantDrafts["1:call-1"] = {
      turn: 1,
      step: 0,
      llmCallId: "call-1",
      updateIndex: 1,
      snapshot: {
        content: [{ kind: "text", text: "partial" }],
        pending: null,
        stop_reason: null,
        usage: null,
        model: null,
      },
    };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    expect(await screen.findByText("partial")).toBeInTheDocument();
    expect(screen.getByText("Streaming response")).toHaveClass("sr-only");
    expect(document.querySelectorAll('[data-message-kind="assistant"]')).toHaveLength(1);

    const draft = controller.state.render.assistantDrafts["1:call-1"];
    if (draft !== undefined) {
      draft.updateIndex = 2;
      draft.snapshot = { ...draft.snapshot, content: [{ kind: "text", text: "complete" }] };
    }
    controller.publish();
    await waitFor(() => expect(screen.queryByText("partial")).not.toBeInTheDocument());
    expect(screen.getByText("complete")).toBeInTheDocument();

    delete controller.state.render.assistantDrafts["1:call-1"];
    controller.state.render.messages.push({
      kind: "assistant",
      turn: 1,
      blocks: [{ kind: "text", text: "complete" }],
    });
    controller.publish();
    await waitFor(() => expect(screen.queryByText("Streaming response")).not.toBeInTheDocument());
    expect(document.querySelectorAll('[data-message-kind="assistant"]')).toHaveLength(1);
  });

  it("preserves detached reading position and Jump to latest restores bottom follow", async () => {
    const controller = new FakeController();
    render(App, { props: { controller } });

    const conversation = await screen.findByRole("region", { name: "Conversation" });
    let scrollHeight = 1000;
    Object.defineProperty(conversation, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(conversation, "clientHeight", {
      configurable: true,
      value: 400,
    });
    conversation.scrollTop = 200;
    await fireEvent.scroll(conversation);

    controller.state.render.assistantDrafts["1:call-1"] = {
      turn: 1,
      step: 0,
      llmCallId: "call-1",
      updateIndex: 1,
      snapshot: {
        content: [{ kind: "text", text: "new stream content" }],
        pending: null,
        stop_reason: null,
        usage: null,
        model: null,
      },
    };
    controller.publish();

    const jump = await screen.findByRole("button", { name: "Jump to latest" });
    expect(conversation.scrollTop).toBe(200);
    scrollHeight = 1200;
    await fireEvent.click(jump);
    expect(conversation.scrollTop).toBe(1200);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).not.toBeInTheDocument();

    const draft = controller.state.render.assistantDrafts["1:call-1"];
    if (draft !== undefined) {
      draft.updateIndex = 2;
      draft.snapshot = {
        ...draft.snapshot,
        content: [{ kind: "text", text: "newer stream content" }],
      };
    }
    scrollHeight = 1400;
    controller.publish();
    await waitFor(() => expect(conversation.scrollTop).toBe(1400));
  });

  it("loads earlier messages once and preserves the visible reading position", async () => {
    const state = readyView();
    if (state.render.session === null) {
      throw new Error("expected loaded Session");
    }
    state.render.session.history = { oldest_turn: 30, has_older: true };
    state.catalog = {
      kind: "ready",
      rows: [
        ...state.catalog.rows,
        {
          session_id: "session-2",
          first_user_message_excerpt: "Another Session",
          last_activity_at: null,
          loaded: false,
        },
      ],
    };
    const controller = new FakeController(state);
    const pending = deferred<void>();
    let scrollHeight = 1000;
    controller.loadOlderHistoryHandler = async () => {
      await pending.promise;
      if (controller.state.render.session === null) {
        throw new Error("expected loaded Session");
      }
      controller.state.render.session.items.unshift({
        kind: "user_message",
        base: {
          id: "older-item",
          seq: 0,
          session_id: "session-1",
          turn: 0,
          at: "2026-09-01T00:00:00Z",
        },
        text: "earlier message",
      });
      controller.state.render.session.history = { oldest_turn: 0, has_older: false };
      controller.state.render.messages.unshift({
        kind: "user",
        turn: 0,
        text: "earlier message",
      });
      scrollHeight = 1400;
      controller.publish();
    };
    render(App, { props: { controller } });

    const conversation = await screen.findByRole("region", { name: "Conversation" });
    Object.defineProperty(conversation, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(conversation, "clientHeight", {
      configurable: true,
      value: 400,
    });
    conversation.scrollTop = 100;
    await fireEvent.scroll(conversation);

    const load = screen.getByRole("button", { name: "Load earlier messages" });
    await fireEvent.click(load);
    expect(screen.getByRole("button", { name: "Loading earlier messages…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New Chat" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Another Session" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      screen.getByText("Wait for earlier messages to finish loading before changing Sessions."),
    ).toBeInTheDocument();
    await fireEvent.click(load);
    expect(controller.operations).toEqual(["loadOlderHistory"]);

    conversation.scrollTop = 250;
    await fireEvent.scroll(conversation);

    pending.resolve();
    expect(await screen.findByText("earlier message")).toBeInTheDocument();
    await waitFor(() => expect(conversation.scrollTop).toBe(650));
    expect(screen.queryByRole("button", { name: "Load earlier messages" })).not.toBeInTheDocument();
  });

  it("shows an older-history error and allows retry", async () => {
    const state = readyView();
    if (state.render.session === null) {
      throw new Error("expected loaded Session");
    }
    state.render.session.history = { oldest_turn: 30, has_older: true };
    const controller = new FakeController(state);
    let attempts = 0;
    controller.loadOlderHistoryHandler = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("history temporarily unavailable");
      }
      if (controller.state.render.session === null) {
        throw new Error("expected loaded Session");
      }
      controller.state.render.session.history = { oldest_turn: 0, has_older: false };
      controller.publish();
    };
    render(App, { props: { controller } });

    await fireEvent.click(
      await screen.findByRole("button", { name: "Load earlier messages" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load earlier messages.",
    );
    expect(screen.queryByText("history temporarily unavailable")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Load earlier messages" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(controller.operations).toEqual(["loadOlderHistory", "loadOlderHistory"]);
  });

  it("boots through the injected controller and submits only typed intent", async () => {
    const controller = new FakeController();
    const rendered = render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "  hello MoonTide  " } });
    await fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(controller.operations).toEqual(["submitTurn:  hello MoonTide  "]);
    });
    expect(input).toHaveValue("");
    expect(controller.starts).toBe(1);

    rendered.unmount();
    await waitFor(() => expect(controller.disposals).toBe(1));
  });

  it("allows Blank first Send and does not clear text typed after its draft snapshot", async () => {
    const state = readyView();
    state.render = createRenderState();
    state.render.delivery.connectionEpoch = 1;
    state.catalog = { kind: "empty", rows: [] };
    const controller = new FakeController(state);
    const pending = deferred<DesktopResponse>();
    controller.submitTurnHandler = async () => pending.promise;
    render(App, { props: { controller } });

    const input = await screen.findByRole("textbox", { name: "Message" });
    expect(input).toBeEnabled();
    await fireEvent.input(input, { target: { value: "first draft" } });
    await fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() => expect(controller.operations).toEqual(["submitTurn:first draft"]));

    await fireEvent.input(input, { target: { value: "next draft" } });
    pending.resolve({ kind: "turn_accepted", turn: 1 });

    await waitFor(() => expect(input).toHaveValue("next draft"));
  });

  it("keeps first Send disabled while the real Controller is creating a Session", async () => {
    const bridge = new IntegrationBridge();
    const pendingCreate = deferred<DesktopResponse>();
    bridge.createSessionHandler = async () => pendingCreate.promise;
    const controller = new DesktopController(bridge);
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(controller.state.connection).toEqual({ kind: "ready" }));
    await fireEvent.input(input, { target: { value: "first" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(controller.state.firstSend.kind).toBe("creating_session"));

    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sending" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New Chat" })).toBeDisabled();
    await fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    expect(bridge.createCalls).toBe(1);
    expect(bridge.submitCalls).toBe(0);

    pendingCreate.resolve({
      kind: "session_ready",
      connection_epoch: 1,
      snapshot: protocolSnapshot(),
    });
    await waitFor(() => expect(bridge.submitCalls).toBe(1));
  });

  it("renders a submitted user message from the terminal authoritative snapshot", async () => {
    const bridge = new IntegrationBridge();
    const controller = new DesktopController(bridge);
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await waitFor(() => expect(controller.state.connection).toEqual({ kind: "ready" }));
    await waitFor(() => expect(input).toBeEnabled());
    await fireEvent.input(input, { target: { value: "hello MoonTide" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(""));

    bridge.completeTurn();

    expect(await screen.findByText("hello MoonTide")).toBeInTheDocument();
    expect(screen.queryByText("Start a conversation with MoonTide.")).not.toBeInTheDocument();
  });

  it("maps active-turn and approval controls to controller intents", async () => {
    const active = readyView();
    active.render.run = { thinking: { turn: 1, step: 0 } };
    const activeController = new FakeController(active);
    const activeView = render(App, { props: { controller: activeController } });

    await fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(activeController.operations).toEqual(["cancelTurn"]));
    activeView.unmount();

    const approval = readyView();
    approval.render.run = {
      waiting_approval: { turn: 1, request_id: "approval-1" },
    };
    approval.render.approvals["approval-1"] = {
      request: {
        id: "approval-1",
        turn: 1,
        call: { tool_use_id: "tool-1", name: "bash", input: { cmd: "pwd" } },
        working_dir: "/workspace",
      },
    };
    const approvalController = new FakeController(approval);
    render(App, { props: { controller: approvalController } });

    await fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(approvalController.operations).toEqual([
        "approve:approval-1",
        "deny:approval-1:denied from desktop ui",
      ]),
    );
  });

  it("keeps approval controls enabled while local submit is still pending", async () => {
    const pending = deferred<DesktopResponse>();
    const controller = new FakeController(readyView());
    controller.submitTurnHandler = async () => pending.promise;
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "needs approval" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    controller.state = {
      ...controller.state,
      render: {
        ...controller.state.render,
        run: { waiting_approval: { turn: 1, request_id: "approval-1" } },
        approvals: {
          "approval-1": {
            request: {
              id: "approval-1",
              turn: 1,
              call: { tool_use_id: "tool-1", name: "bash", input: { cmd: "pwd" } },
              working_dir: "/workspace",
            },
          },
        },
      },
    };
    controller.publish();

    expect(await screen.findByText("Approval required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeEnabled();

    pending.resolve({ kind: "turn_accepted", turn: 1 });
    await waitFor(() => expect(controller.operations).toEqual(["submitTurn:needs approval"]));
  });

  it("keeps one inline Approval owner locked while its decision is resolving", async () => {
    const state = readyView();
    state.render.run = {
      waiting_approval: { turn: 1, request_id: "approval-1" },
    };
    state.render.approvals["approval-1"] = {
      request: {
        id: "approval-1",
        turn: 1,
        call: { tool_use_id: "tool-1", name: "bash", input: { cmd: "pwd" } },
        working_dir: "/workspace",
      },
    };
    const pending = deferred<DesktopResponse>();
    const controller = new FakeController(state);
    controller.approveHandler = async () => pending.promise;
    render(App, { props: { controller } });

    await fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    expect(await screen.findByText("Resolving approval…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();

    pending.resolve({ kind: "approval_accepted", approval_id: "approval-1" });
    await waitFor(() => expect(screen.queryByText("Resolving approval…")).not.toBeInTheDocument());
  });

  // A transport failure is explained where it blocks the conversation. Resync recovery stays off
  // the reading surface while disconnected so Connection lost is the only status, and chrome badges
  // stay absent while Composer and lifecycle intents remain disabled.
  it("makes transport disconnection visible without stacking resync recovery", async () => {
    const state = readyView();
    state.connection = { kind: "disconnected", message: "event stream closed" };
    state.render.delivery.resyncRequired = true;
    state.render.notices.push({
      kind: "resync",
      message: "desktop state requires resync: event_gap",
      recoverable: true,
      errorKind: null,
    });

    const controller = new FakeController(state);
    render(App, { props: { controller } });

    expect(await screen.findByText("Connection lost")).toBeInTheDocument();
    expect(screen.getByText("MoonTide disconnected. Retry to continue.")).toBeInTheDocument();
    expect(screen.queryByText("Disconnected")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Updating conversation")).not.toBeInTheDocument();
    expect(screen.queryByText("event stream closed")).not.toBeInTheDocument();
    expect(screen.queryByText("desktop state requires resync: event_gap")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
    await fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(controller.operations).toContain("retryRuntime");
  });

  // In-flight delivery recovery is chat copy only while the connection is still ready; protocol
  // reason codes stay in state and never reach the reading surface.
  it("shows in-flight resync recovery while the connection stays ready", async () => {
    const state = readyView();
    state.render.delivery.resyncRequired = true;
    state.render.notices.push({
      kind: "resync",
      message: "desktop state requires resync: event_gap",
      recoverable: true,
      errorKind: null,
    });

    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByText("Updating conversation")).toBeInTheDocument();
    expect(
      screen.getByText("Live updates were interrupted. Restoring the latest state."),
    ).toBeInTheDocument();
    expect(screen.queryByText("desktop state requires resync: event_gap")).not.toBeInTheDocument();
  });

  // Excerpt is the only Session title. Missing excerpt uses Untitled session; opaque IDs stay out
  // of the Top Bar, row label, and hover title.
  it("titles Sessions without an excerpt as Untitled session", async () => {
    const state = readyView();
    if (state.catalog.kind !== "ready") {
      throw new Error("expected ready catalog");
    }
    state.catalog.rows.push({
      session_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      first_user_message_excerpt: null,
      last_activity_at: null,
      loaded: false,
    });
    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByRole("heading", { name: "Untitled session" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Untitled session, Loaded" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Untitled session$/ })).toHaveAttribute(
      "title",
      "Untitled session",
    );
    expect(screen.queryByText("Session session-1")).not.toBeInTheDocument();
    expect(screen.queryByText("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).not.toBeInTheDocument();
  });

  // Controller throw text is a protocol fact. The chat surface maps it to a recoverable sentence.
  it("maps Controller action failures instead of showing Host strings", async () => {
    const controller = new FakeController(readyView());
    controller.submitTurnHandler = async () => {
      throw new Error("Desktop Session creation baseline still requires resync");
    };
    render(App, { props: { controller } });

    const input = await screen.findByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "hello" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Action failed")).toBeInTheDocument();
    expect(screen.getByText("That action didn't complete. Try again.")).toBeInTheDocument();
    expect(
      screen.queryByText("Desktop Session creation baseline still requires resync"),
    ).not.toBeInTheDocument();
  });

  // Stopped and rejected-command notices keep kind/code in state; the surface never echoes Host
  // Display text such as desktop host stopped or desktop host is busy.
  it("maps stopped and internal notices without protocol wording", async () => {
    const state = readyView();
    state.render.notices.push(
      {
        kind: "stopped",
        message: "desktop host stopped",
        recoverable: false,
        errorKind: null,
      },
      {
        kind: "error",
        message: "desktop host is busy",
        recoverable: true,
        errorKind: null,
      },
    );
    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByText("MoonTide stopped")).toBeInTheDocument();
    expect(screen.getByText("This window is no longer connected.")).toBeInTheDocument();
    expect(screen.getByText("Reply didn't finish")).toBeInTheDocument();
    expect(screen.getByText("The reply didn't finish. Try again.")).toBeInTheDocument();
    expect(screen.queryByText("desktop host stopped")).not.toBeInTheDocument();
    expect(screen.queryByText("desktop host is busy")).not.toBeInTheDocument();
  });

  // Startup is a temporary action blocker, so Blank explains it beside the disabled Composer
  // without creating a persistent connection badge in the application chrome.
  it("explains startup beside the disabled Blank Composer", async () => {
    const state = blankView();
    state.connection = { kind: "starting" };
    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByText("Starting MoonTide")).toBeInTheDocument();
    expect(screen.getByText("Sending will be available shortly.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    expect(screen.queryByText("Connecting")).not.toBeInTheDocument();
  });

  it("renders Blank with real Recent rows and keeps New Chat local until a Session exists", async () => {
    const state = blankView();
    state.catalog = {
      kind: "ready",
      rows: [
        {
          session_id: "session-2",
          first_user_message_excerpt: "Review the provider boundary",
          last_activity_at: "2026-08-31T00:00:00Z",
          loaded: false,
        },
      ],
    };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    expect(await screen.findByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "local draft" } });
    await fireEvent.click(screen.getByRole("button", { name: "New Chat" }));

    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(controller.operations).toEqual([]);

    const historicalSession = screen.getByRole("button", {
      name: "Review the provider boundary",
    });
    expect(historicalSession).toHaveClass("mt-session-row");
    historicalSession.focus();
    expect(historicalSession).toHaveFocus();
    historicalSession.click();
    await waitFor(() => {
      expect(controller.operations).toEqual(["loadSession:session-2"]);
    });
  });

  // Blank projection keeps Host run "starting" until a Session snapshot arrives. That is not an
  // active Turn, so Recent rows stay enabled after the connection is ready.
  it("loads a Recent Session from Blank while the Host run is still starting", async () => {
    const state = blankView();
    state.render.run = "starting";
    state.catalog = {
      kind: "ready",
      rows: [
        {
          session_id: "session-2",
          first_user_message_excerpt: "Review the provider boundary",
          last_activity_at: "2026-08-31T00:00:00Z",
          loaded: false,
        },
      ],
    };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    const historicalSession = await screen.findByRole("button", {
      name: "Review the provider boundary",
    });
    expect(historicalSession).toHaveAttribute("aria-disabled", "false");
    await fireEvent.click(historicalSession);
    expect(controller.operations).toEqual(["loadSession:session-2"]);
  });

  // A composing or repeated Send chord must not submit; the first completed chord submits the
  // exact draft once and preserves ordinary Enter for multiline input.
  it("guards Composer submission during IME composition and key repeat", async () => {
    const controller = new FakeController(readyView());
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "中文输入" } });
    await fireEvent.keyDown(input, { key: "Enter", metaKey: true, isComposing: true });
    await fireEvent.keyDown(input, { key: "Enter", metaKey: true, repeat: true });
    const plainEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(plainEnter);
    expect(plainEnter.defaultPrevented).toBe(false);
    expect(controller.operations).toEqual([]);

    await fireEvent.keyDown(input, { key: "Enter", metaKey: true });
    await waitFor(() => expect(controller.operations).toEqual(["submitTurn:中文输入"]));
  });

  // Stop is a global active-Turn shortcut only: idle Control+Period remains untouched, while an
  // active chord produces one cancellation even if the keyboard repeats.
  it("handles the active-Turn Stop shortcut without capturing idle period input", async () => {
    const state = readyView();
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    await fireEvent.keyDown(window, { key: ".", ctrlKey: true });
    expect(controller.operations).toEqual([]);

    controller.state.render.run = { thinking: { turn: 1, step: 0 } };
    controller.publish();
    expect(await screen.findByText("MoonTide is working · Cmd/Ctrl+. to stop")).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("session-drawer-layout")).toHaveAttribute("data-state", "open");
    await fireEvent.keyDown(window, { key: ".", ctrlKey: true, isComposing: true });
    expect(controller.operations).toEqual([]);
    await fireEvent.keyDown(window, { key: ".", ctrlKey: true });
    await fireEvent.keyDown(window, { key: ".", ctrlKey: true, repeat: true });
    await waitFor(() => expect(controller.operations).toEqual(["cancelTurn"]));
  });

  // Even when Recent is empty, a disabled lifecycle action must reference a visible reason so
  // keyboard and screen-reader users receive the same explanation.
  it("associates the Session block reason when the catalog is empty", async () => {
    const state = readyView();
    state.catalog = { kind: "empty", rows: [] };
    state.render.run = { thinking: { turn: 1, step: 0 } };
    render(App, { props: { controller: new FakeController(state) } });

    const newChat = screen.getByRole("button", { name: "New Chat" });
    const reasonId = newChat.getAttribute("aria-describedby");
    expect(newChat).toBeDisabled();
    expect(reasonId).not.toBeNull();
    expect(document.getElementById(reasonId ?? "")).toHaveTextContent(
      "Finish or stop the current turn before changing Sessions.",
    );
  });

  it("disables earlier-history loading while the current Turn is active", async () => {
    const state = readyView();
    if (state.render.session === null) {
      throw new Error("expected loaded Session");
    }
    state.render.session.history = { oldest_turn: 30, has_older: true };
    state.render.run = { thinking: { turn: 1, step: 0 } };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    const load = await screen.findByRole("button", { name: "Load earlier messages" });
    expect(load).toBeDisabled();
    const reasonId = load.getAttribute("aria-describedby");
    expect(reasonId).not.toBeNull();
    expect(document.getElementById(reasonId ?? "")).toHaveTextContent(
      "Finish or stop the current turn before loading earlier messages.",
    );
    await fireEvent.click(load);
    expect(controller.operations).toEqual([]);

    controller.state.render.run = "idle";
    controller.publish();
    await waitFor(() => expect(load).toBeEnabled());
  });

  // Loaded New Chat waits for the authoritative Blank state, then places focus in the new
  // Composer without creating a frontend-only Session identity.
  it("focuses the Blank Composer after Loaded New Chat completes", async () => {
    const controller = new FakeController(readyView());
    const reset = deferred<void>();
    controller.newChatHandler = async () => {
      await reset.promise;
      controller.state.render = createRenderState();
      controller.state.catalog = {
        kind: "ready",
        rows: controller.state.catalog.rows.map((row) => ({ ...row, loaded: false })),
      };
      controller.publish();
    };
    render(App, { props: { controller } });

    await fireEvent.click(screen.getByRole("button", { name: "New Chat" }));
    expect(controller.operations).toEqual(["newChat"]);
    reset.resolve();

    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus());
    expect(screen.getByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
  });

  // Unsafe Session switching stays disabled with an explicit reason; once the authoritative run
  // is idle, the same candidate activates and focus moves to the Loaded conversation heading.
  it("explains blocked Session switching and focuses Loaded after an allowed switch", async () => {
    const state = readyView();
    state.catalog = {
      kind: "ready",
      rows: [
        {
          session_id: "session-1",
          first_user_message_excerpt: "Current Session",
          last_activity_at: null,
          loaded: true,
        },
        {
          session_id: "session-2",
          first_user_message_excerpt: "Historical Session",
          last_activity_at: null,
          loaded: false,
        },
      ],
    };
    state.render.run = { thinking: { turn: 1, step: 0 } };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    const candidate = await screen.findByRole("button", { name: "Historical Session" });
    expect(candidate).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Finish or stop the current turn before changing Sessions.")).toBeInTheDocument();
    await fireEvent.click(candidate);
    expect(controller.operations).toEqual([]);

    controller.state.render.run = "idle";
    controller.publish();
    await waitFor(() => expect(candidate).toHaveAttribute("aria-disabled", "false"));
    const sessionLoad = deferred<void>();
    controller.loadSessionHandler = async () => {
      await sessionLoad.promise;
      if (controller.state.render.session === null) {
        throw new Error("expected a Loaded Session");
      }
      controller.state.render.session.summary.session_id = "session-2";
      controller.state.catalog = {
        kind: "ready",
        rows: controller.state.catalog.rows.map((row) => ({
          ...row,
          loaded: row.session_id === "session-2",
        })),
      };
      controller.publish();
    };
    await fireEvent.click(candidate);
    await waitFor(() => expect(controller.operations).toEqual(["loadSession:session-2"]));
    expect(screen.getByRole("status", { name: "Loading conversation" })).toBeInTheDocument();
    expect(candidate).toHaveAccessibleName("Historical Session, Loading");
    expect(screen.queryByRole("status", { name: "" })).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Recent Sessions" }).parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await fireEvent.click(candidate);
    expect(controller.operations).toEqual(["loadSession:session-2"]);
    sessionLoad.resolve();
    await waitFor(
      () => expect(screen.getByRole("heading", { name: "Historical Session" })).toHaveFocus(),
      { timeout: 2000 },
    );
  });

  // A delayed submit may restore focus only when the user stayed inside the Composer; moving to
  // another control while waiting must keep that explicit destination focused.
  it("does not steal focus after a delayed submit when the user moved elsewhere", async () => {
    const controller = new FakeController(readyView());
    const submission = deferred<DesktopResponse>();
    controller.submitTurnHandler = () => submission.promise;
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "wait for this" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const themeButton = screen.getByRole("button", { name: "Switch to Black theme" });
    themeButton.focus();
    await fireEvent.click(themeButton);
    expect(themeButton).toHaveFocus();

    submission.resolve({ kind: "turn_accepted", turn: 1 });
    await waitFor(() => expect(input).toHaveValue(""));
    expect(themeButton).toHaveFocus();
  });

  // Stream, notice, and theme updates may change presentation but never move focus away from the
  // user's current Composer destination.
  it("keeps Composer focus during background presentation updates", async () => {
    const controller = new FakeController(readyView());
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    input.focus();
    controller.state.render.notices.push({
      kind: "error",
      message: "background notice",
      recoverable: true,
      errorKind: null,
    });
    controller.state.render.assistantDrafts["1:call-2"] = {
      turn: 1,
      step: 0,
      llmCallId: "call-2",
      updateIndex: 1,
      snapshot: {
        content: [{ kind: "text", text: "background stream" }],
        pending: null,
        stop_reason: null,
        usage: null,
        model: null,
      },
    };
    controller.publish();

    await screen.findByText("background stream");
    expect(input).toHaveFocus();
  });

  // Initial state is silent; explicit theme and connection changes use a polite status region,
  // and a projection-provided live approval cue exposes only the tool name.
  it("announces explicit UI changes and live approvals without announcing initial state", async () => {
    const state = readyView();
    state.render.liveAnnouncement = {
      id: "1:6:old-approval",
      kind: "approval_required",
      toolName: "historical-tool",
    };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    const uiStatus = screen.getByTestId("ui-status-announcement");
    const eventStatus = screen.getByTestId("live-event-announcement");
    expect(uiStatus).toHaveTextContent("");
    expect(eventStatus).toHaveTextContent("");
    expect(eventStatus).not.toHaveTextContent("historical-tool");

    await fireEvent.click(screen.getByRole("button", { name: "Switch to Black theme" }));
    expect(uiStatus).toHaveTextContent("Black theme enabled");

    controller.state.connection = { kind: "disconnected", message: "secret detail" };
    controller.publish();
    await waitFor(() => expect(uiStatus).toHaveTextContent("MoonTide connection unavailable"));
    expect(uiStatus).not.toHaveTextContent("secret detail");

    controller.state.render.liveAnnouncement = {
      id: "1:7:approval-1",
      kind: "approval_required",
      toolName: "bash",
    };
    controller.publish();
    await waitFor(() => expect(eventStatus).toHaveTextContent("Approval required for bash"));
  });

  it("keeps catalog failure distinct from empty and retries through the Controller", async () => {
    const state = blankView();
    state.catalog = {
      kind: "failed",
      rows: [],
      message: "Session catalog unavailable",
    };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    expect(await screen.findByText("Couldn't load recent conversations.")).toBeInTheDocument();
    expect(screen.queryByText("Session catalog unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("No recent conversations.")).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole("button", { name: "Retry recent Sessions" }));
    await waitFor(() => expect(controller.operations).toEqual(["retryCatalog"]));
  });

  // Listing with retained rows keeps the same Session list DOM; busy state is aria-only so
  // rows do not jump when the catalog refreshes.
  it("shows retained Session rows as refreshing while the catalog is listing", async () => {
    const state = blankView();
    state.catalog = {
      kind: "listing",
      rows: [
        {
          session_id: "session-2",
          first_user_message_excerpt: "Retained conversation",
          last_activity_at: null,
          loaded: false,
        },
      ],
    };
    render(App, { props: { controller: new FakeController(state) } });

    expect(await screen.findByRole("button", { name: "Retained conversation" })).toBeInTheDocument();
    expect(screen.queryByText("Refreshing recent Sessions…")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Recent Sessions" }).parentElement).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("settles accepted submission phase when authoritative Turn state advances", async () => {
    const controller = new FakeController();
    render(App, { props: { controller } });

    const input = screen.getByRole("textbox", { name: "Message" });
    await fireEvent.input(input, { target: { value: "continue" } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByRole("button", { name: "Sending" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "New Chat" })).toBeDisabled();

    controller.state.render.run = { thinking: { turn: 1, step: 0 } };
    controller.publish();
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop" })).toBeEnabled());

    controller.state.render.run = "idle";
    if (controller.state.render.session !== null) {
      controller.state.render.session.summary.last_turn = 1;
    }
    controller.publish();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "New Chat" })).toBeEnabled();
  });

  it("keeps cancellation pending until authoritative Turn state becomes terminal", async () => {
    const state = readyView();
    state.render.run = { thinking: { turn: 1, step: 0 } };
    const controller = new FakeController(state);
    render(App, { props: { controller } });

    await fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("button", { name: "Cancelling" })).toBeDisabled();

    controller.state.render.run = "idle";
    controller.publish();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled());
    expect(screen.getByRole("button", { name: "Stop" })).toBeDisabled();
  });

  it("persists an explicit White or Black choice without changing Chat state", async () => {
    const controller = new FakeController(blankView());
    render(App, { props: { controller } });

    const switchToBlack = await screen.findByRole("button", {
      name: "Switch to Black theme",
    });
    await fireEvent.click(switchToBlack);

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "black");
    expect(window.localStorage.getItem("moontide.theme")).toBe("black");
    expect(screen.getByRole("heading", { name: "How can I help?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to White theme" })).toBeInTheDocument();
  });

  // The Session list is a viewport-independent docked pane; resizing updates its layout width,
  // keyboard bounds stay explicit, and collapsing animates to 0 width without a modal layer.
  it("resizes and collapses the docked Session drawer without an overlay", async () => {
    render(App, { props: { controller: new FakeController(blankView()) } });

    const drawer = await screen.findByTestId("session-drawer-layout");
    const resizer = screen.getByRole("separator", { name: "Resize Session drawer" });
    expect(drawer).toHaveStyle({ width: "240px" });
    expect(resizer).toHaveAttribute("aria-valuemin", "200");
    expect(resizer).toHaveAttribute("aria-valuemax", "360");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();

    await fireEvent.pointerDown(resizer, { button: 0, clientX: 240 });
    await fireEvent.pointerMove(window, { clientX: 320 });
    await fireEvent.pointerUp(window);
    expect(drawer).toHaveStyle({ width: "320px" });
    expect(resizer).toHaveAttribute("aria-valuenow", "320");

    await fireEvent.keyDown(resizer, { key: "ArrowLeft" });
    expect(drawer).toHaveStyle({ width: "304px" });
    await fireEvent.keyDown(resizer, { key: "Home" });
    expect(drawer).toHaveStyle({ width: "200px" });
    await fireEvent.keyDown(resizer, { key: "End" });
    expect(drawer).toHaveStyle({ width: "360px" });

    await fireEvent.click(screen.getByRole("button", { name: "Close Session drawer" }));
    expect(drawer).toHaveStyle({ width: "0px" });
    expect(drawer).toHaveAttribute("data-state", "closed");
    expect(screen.queryByRole("separator", { name: "Resize Session drawer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const opener = screen.getByRole("button", { name: "Open Session drawer" });
    await fireEvent.click(opener);
    expect(drawer).toHaveStyle({ width: "360px" });
    expect(drawer).toHaveAttribute("data-state", "open");
    expect(screen.getByRole("separator", { name: "Resize Session drawer" })).toBeInTheDocument();
  });
});

function readyView(): DesktopViewState {
  const render = createRenderState();
  render.run = "idle";
  render.session = {
    summary: {
      session_id: "session-1",
      cwd: "/workspace",
      last_turn: null,
      item_count: 0,
    },
    items: [],
    history: { oldest_turn: null, has_older: false },
  };
  return {
    connection: { kind: "ready" },
    catalog: {
      kind: "ready",
      rows: [
        {
          session_id: "session-1",
          first_user_message_excerpt: null,
          last_activity_at: null,
          loaded: true,
        },
      ],
    },
    firstSend: { kind: "idle" },
    render,
  };
}

function blankView(): DesktopViewState {
  const render = createRenderState();
  render.run = "idle";
  render.delivery.connectionEpoch = 1;
  return {
    connection: { kind: "ready" },
    catalog: { kind: "empty", rows: [] },
    firstSend: { kind: "idle" },
    render,
  };
}

function protocolSnapshot(lastSeq = 0, userText?: string): DesktopSnapshot {
  const items =
    userText === undefined
      ? []
      : [
          {
            kind: "user_message" as const,
            base: {
              id: "item-1",
              seq: 0,
              session_id: "session-1",
              turn: 0,
              at: "2026-08-25T00:00:00Z",
            },
            text: userText,
          },
        ];
  return {
    session: {
      summary: {
        session_id: "session-1",
        cwd: "/workspace",
        last_turn: userText === undefined ? null : 0,
        item_count: items.length,
      },
      items,
      history: {
        oldest_turn: userText === undefined ? null : 0,
        has_older: false,
      },
    },
    state: "idle",
    pending_approvals: [],
    active_assistant_calls: [],
    delivery: {
      last_delivered_seq: lastSeq,
      resync_required: false,
      dropped_snapshots: 0,
      buffered_events: 0,
    },
  };
}


function wireEvent(seq: number, event: DesktopProtocolEvent): unknown {
  return {
    protocol_version: 1,
    connection_epoch: 1,
    request_id: null,
    seq,
    payload: { kind: "event", event },
  };
}
