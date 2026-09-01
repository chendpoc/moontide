import { describe, expect, it } from "vitest";

import {
  parseDesktopMessageEnvelope,
  type DesktopProtocolEvent,
  type DesktopResponse,
  type DesktopSnapshot,
  type ModelResponseSnapshot,
  type ToolCall,
  type ToolResult,
} from "$lib/protocol/index.js";
import {
  createRenderState,
  reduceEnvelope,
  reduceLiveEnvelope,
  type RenderState,
} from "$lib/projection/renderState.js";

function event(seq: number, payload: DesktopProtocolEvent, epoch = 1) {
  return parseDesktopMessageEnvelope({
    protocol_version: 1,
    connection_epoch: epoch,
    request_id: null,
    seq,
    payload: { kind: "event", event: payload },
  });
}

function response(payload: DesktopResponse, epoch = 1) {
  return parseDesktopMessageEnvelope({
    protocol_version: 1,
    connection_epoch: epoch,
    request_id: "request-test",
    seq: null,
    payload: { kind: "response", response: payload },
  });
}

function modelSnapshot(text: string): ModelResponseSnapshot {
  return {
    content: [{ kind: "text", text }],
    pending: null,
    stop_reason: null,
    usage: null,
    model: null,
  };
}

function desktopSnapshot(): DesktopSnapshot {
  return {
    session: {
      summary: {
        session_id: "session-1",
        cwd: ".",
        last_turn: null,
        item_count: 0,
      },
      items: [],
      history: { oldest_turn: null, has_older: false },
    },
    state: "idle",
    pending_approvals: [],
    active_assistant_calls: [],
    delivery: {
      last_delivered_seq: 0,
      resync_required: true,
      dropped_snapshots: 1,
      buffered_events: 0,
    },
  };
}

function call(id: string): ToolCall {
  return { tool_use_id: id, name: "grep", input: { pattern: "hello" } };
}

function result(toolCall: ToolCall): ToolResult {
  return {
    tool_use_id: toolCall.tool_use_id,
    name: toolCall.name,
    status: "succeeded",
    content: { text: "ok" },
  };
}

function apply(state: RenderState, envelope: ReturnType<typeof event>): RenderState {
  return reduceEnvelope(state, envelope).state;
}

describe("RenderState Rust parity", () => {
  it("replaces snapshots by call identity and requests resync on a sequence gap", () => {
    const initial = createRenderState();
    const first = reduceEnvelope(
      initial,
      event(1, {
        kind: "assistant_response_snapshot",
        turn: 1,
        step: 0,
        llm_call_id: "call-1",
        update_index: 1,
        snapshot: modelSnapshot("Hello"),
      }),
    );
    expect(first.result).toBe("applied");
    expect(first.state.assistantDrafts["1:call-1"]?.snapshot.content).toEqual(
      modelSnapshot("Hello").content,
    );
    expect(initial.assistantDrafts).toEqual({});

    const stale = reduceEnvelope(
      first.state,
      event(2, {
        kind: "assistant_response_snapshot",
        turn: 1,
        step: 0,
        llm_call_id: "call-1",
        update_index: 0,
        snapshot: modelSnapshot("stale"),
      }),
    );
    expect(stale.result).toBe("ignored");
    expect(stale.state.assistantDrafts["1:call-1"]?.snapshot.content).toEqual(
      modelSnapshot("Hello").content,
    );

    const gap = reduceEnvelope(stale.state, event(4, { kind: "turn_ended", turn: 1 }));
    expect(gap.result).toBe("resync_required");
    expect(gap.state.delivery.resyncRequired).toBe(true);
  });

  it("removes a finalized draft and never reopens the same call", () => {
    let state = apply(
      createRenderState(),
      event(1, {
        kind: "assistant_response_snapshot",
        turn: 1,
        step: 0,
        llm_call_id: "call-1",
        update_index: 1,
        snapshot: modelSnapshot("done"),
      }),
    );
    state = apply(
      state,
      event(2, {
        kind: "assistant_finalized",
        turn: 1,
        llm_call_id: "call-1",
        blocks: [{ kind: "text", text: "done" }],
      }),
    );
    const reopened = reduceEnvelope(
      state,
      event(3, {
        kind: "assistant_response_snapshot",
        turn: 1,
        step: 0,
        llm_call_id: "call-1",
        update_index: 2,
        snapshot: modelSnapshot("again"),
      }),
    );

    expect(reopened.result).toBe("ignored");
    expect(reopened.state.assistantDrafts).toEqual({});
    expect(reopened.state.messages).toHaveLength(1);
  });

  it("requests resync for an orphan or mismatched ToolResult", () => {
    const toolCall = call("call-1");
    const orphan = reduceEnvelope(
      createRenderState(),
      event(1, { kind: "tool_result", turn: 1, result: result(toolCall) }),
    );
    expect(orphan.result).toBe("resync_required");
    expect(orphan.state.tools).toEqual({});
  });

  it("replaces the snapshot baseline and then projects Stopped", () => {
    let state = apply(
      createRenderState(),
      event(1, {
        kind: "assistant_response_snapshot",
        turn: 1,
        step: 0,
        llm_call_id: "call-1",
        update_index: 1,
        snapshot: modelSnapshot("transient"),
      }),
    );
    const baseline = reduceEnvelope(
      state,
      response({ kind: "snapshot", connection_epoch: 1, snapshot: desktopSnapshot() }),
    );
    expect(baseline.state.session).not.toBeNull();
    expect(baseline.state.assistantDrafts).toEqual({});
    expect(baseline.state.run).toBe("idle");
    expect(baseline.state.delivery.lastSeq).toBe(0);
    expect(baseline.state.delivery.resyncRequired).toBe(false);

    const report = {
      cancelled_turn: 1,
      progress_flushed: true,
      diagnostic_log_flushed: true,
    };
    state = apply(baseline.state, event(1, { kind: "stopped", report }));
    expect(state.stoppedReport).toEqual(report);
  });

  it("keeps a provider failure visible when the terminal snapshot already includes its event", () => {
    const snapshot = desktopSnapshot();
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
    snapshot.delivery.last_delivered_seq = 4;

    const restored = reduceEnvelope(
      createRenderState(),
      response({ kind: "snapshot", connection_epoch: 1, snapshot }),
    ).state;

    expect(restored.notices).toContainEqual({
      kind: "error",
      message: "HTTP 402 Payment Required: Insufficient Balance",
      recoverable: true,
      errorKind: "provider",
      turn: 0,
    });

    const replayed = reduceEnvelope(
      restored,
      event(4, {
        kind: "turn_failed",
        turn: 0,
        error: {
          kind: "provider",
          message: "HTTP 402 Payment Required: Insufficient Balance",
          recoverable: true,
        },
      }),
    ).state;
    expect(replayed.notices).toHaveLength(1);
  });

  it("deduplicates event then snapshot for one Turn but preserves the same error on another Turn", () => {
    const error = {
      kind: "provider" as const,
      message: "HTTP 402 Payment Required: Insufficient Balance",
      recoverable: true,
    };
    let state = apply(
      createRenderState(),
      event(1, { kind: "turn_failed", turn: 0, error }),
    );
    const failed = desktopSnapshot();
    failed.state = { failed: { turn: 0, error } };
    failed.delivery.last_delivered_seq = 1;
    state = reduceEnvelope(
      state,
      response({ kind: "snapshot", connection_epoch: 1, snapshot: failed }),
    ).state;
    expect(state.notices).toHaveLength(1);

    state = apply(state, event(2, { kind: "turn_failed", turn: 1, error }));
    expect(state.notices).toHaveLength(2);
    expect(state.notices.map((notice) => notice.turn)).toEqual([0, 1]);
  });

  it("does not synthesize a failure notice from an idle snapshot", () => {
    const restored = reduceEnvelope(
      createRenderState(),
      response({ kind: "snapshot", connection_epoch: 1, snapshot: desktopSnapshot() }),
    ).state;

    expect(restored.notices).toEqual([]);
  });

  it("prepends older history once and retains it across later snapshots", () => {
    const latest = desktopSnapshot();
    latest.session.summary.last_turn = 40;
    latest.session.summary.item_count = 3;
    latest.session.items = [
      {
        kind: "user_message",
        base: {
          id: "turn-30",
          seq: 30,
          session_id: "session-1",
          turn: 30,
          at: "2026-09-01T00:00:30Z",
        },
        text: "recent-30",
      },
      {
        kind: "user_message",
        base: {
          id: "turn-40",
          seq: 40,
          session_id: "session-1",
          turn: 40,
          at: "2026-09-01T00:00:40Z",
        },
        text: "recent-40",
      },
    ];
    latest.session.history = { oldest_turn: 30, has_older: true };
    let state = reduceEnvelope(
      createRenderState(),
      response({ kind: "snapshot", connection_epoch: 1, snapshot: latest }),
    ).state;

    state = reduceEnvelope(
      state,
      response({
        kind: "session_history_page",
        session_id: "session-1",
        items: [
          {
            kind: "user_message",
            base: {
              id: "turn-0",
              seq: 0,
              session_id: "session-1",
              turn: 0,
              at: "2026-09-01T00:00:00Z",
            },
            text: "oldest",
          },
          latest.session.items[0]!,
        ],
        oldest_turn: 0,
        has_older: false,
      }),
    ).state;
    expect(state.messages).toEqual([
      { kind: "user", turn: 0, text: "oldest" },
      { kind: "user", turn: 30, text: "recent-30" },
      { kind: "user", turn: 40, text: "recent-40" },
    ]);
    expect(state.session?.items).toHaveLength(3);
    expect(state.historyExpanded).toBe(true);
    expect(state.session?.history).toEqual({ oldest_turn: 0, has_older: false });

    const refreshed = structuredClone(latest);
    refreshed.session.items = [latest.session.items[1]!];
    refreshed.session.history = { oldest_turn: 40, has_older: true };
    state = reduceEnvelope(
      state,
      response({ kind: "snapshot", connection_epoch: 1, snapshot: refreshed }),
    ).state;
    expect(state.messages.map((message) => message.turn)).toEqual([0, 30, 40]);
    expect(state.session?.history).toEqual({ oldest_turn: 0, has_older: false });
  });

  it("replaces the rolling latest window until the user explicitly expands history", () => {
    const first = desktopSnapshot();
    first.session.items = [
      {
        kind: "user_message",
        base: {
          id: "turn-30",
          seq: 30,
          session_id: "session-1",
          turn: 30,
          at: "2026-09-01T00:00:30Z",
        },
        text: "turn 30",
      },
      {
        kind: "user_message",
        base: {
          id: "turn-59",
          seq: 59,
          session_id: "session-1",
          turn: 59,
          at: "2026-09-01T00:00:59Z",
        },
        text: "turn 59",
      },
    ];
    first.session.history = { oldest_turn: 30, has_older: true };
    let state = reduceEnvelope(
      createRenderState(),
      response({ kind: "snapshot", connection_epoch: 1, snapshot: first }),
    ).state;
    expect(state.historyExpanded).toBe(false);

    const next = desktopSnapshot();
    next.session.items = [
      {
        kind: "user_message",
        base: {
          id: "turn-31",
          seq: 31,
          session_id: "session-1",
          turn: 31,
          at: "2026-09-01T00:00:31Z",
        },
        text: "turn 31",
      },
      {
        kind: "user_message",
        base: {
          id: "turn-60",
          seq: 60,
          session_id: "session-1",
          turn: 60,
          at: "2026-09-01T00:01:00Z",
        },
        text: "turn 60",
      },
    ];
    next.session.history = { oldest_turn: 31, has_older: true };
    state = reduceEnvelope(
      state,
      response({ kind: "snapshot", connection_epoch: 1, snapshot: next }),
    ).state;

    expect(state.messages.map((message) => message.turn)).toEqual([31, 60]);
    expect(state.session?.items.some((item) => item.base.id === "turn-30")).toBe(false);
    expect(state.historyExpanded).toBe(false);
  });

  it("ignores a history page for a different loaded Session", () => {
    const loaded = reduceEnvelope(
      createRenderState(),
      response({ kind: "snapshot", connection_epoch: 1, snapshot: desktopSnapshot() }),
    ).state;

    const output = reduceEnvelope(
      loaded,
      response({
        kind: "session_history_page",
        session_id: "session-2",
        items: [],
        oldest_turn: null,
        has_older: false,
      }),
    );

    expect(output.result).toBe("ignored");
    expect(output.state.session).toEqual(loaded.session);
  });

  // Pending approvals restored from a snapshot stay silent, while a sequenced live event creates
  // one safe announcement that does not include tool input and is not rewritten by stream tokens.
  it("preserves live-event origin for approval announcements", () => {
    const request = {
      id: "approval-1",
      turn: 1,
      call: { tool_use_id: "tool-1", name: "bash", input: { secret: "hidden" } },
      working_dir: ".",
    };
    const snapshot = desktopSnapshot();
    snapshot.pending_approvals = [request];
    const restored = reduceEnvelope(
      createRenderState(),
      response({ kind: "snapshot", connection_epoch: 1, snapshot }),
    );
    expect(restored.state.liveAnnouncement).toBeNull();

    let state = reduceLiveEnvelope(
      createRenderState(),
      event(1, { kind: "approval_requested", request }),
    ).state;
    expect(state.liveAnnouncement).toEqual({
      id: "1:1:approval-1",
      kind: "approval_required",
      toolName: "bash",
    });
    expect(state.liveAnnouncement?.toolName).not.toContain("hidden");

    state = apply(
      state,
      event(2, {
        kind: "assistant_response_snapshot",
        turn: 1,
        step: 0,
        llm_call_id: "call-1",
        update_index: 1,
        snapshot: modelSnapshot("token"),
      }),
    );
    expect(state.liveAnnouncement?.id).toBe("1:1:approval-1");
  });

  // Snapshot keeps only Host-confirmed live drafts. Unproven streaming drafts are dropped
  // silently; a completed baseline is not a user-facing resync failure.
  it("preserves only drafts confirmed active by a snapshot", () => {
    let state = createRenderState();
    for (const [seq, callId] of [
      [1, "call-1"],
      [2, "call-2"],
    ] as const) {
      state = apply(
        state,
        event(seq, {
          kind: "assistant_response_snapshot",
          turn: 1,
          step: 0,
          llm_call_id: callId,
          update_index: 0,
          snapshot: modelSnapshot(callId),
        }),
      );
    }
    const snapshot = desktopSnapshot();
    snapshot.active_assistant_calls = [{ turn: 1, llm_call_id: "call-1" }];
    state = reduceEnvelope(
      state,
      response({ kind: "snapshot", connection_epoch: 1, snapshot }),
    ).state;

    expect(state.assistantDrafts["1:call-1"]).toBeDefined();
    expect(state.assistantDrafts["1:call-2"]).toBeUndefined();
    expect(state.notices.some((notice) => notice.kind === "resync")).toBe(false);
  });

  it("requires a snapshot before accepting events from a new epoch", () => {
    let state = apply(createRenderState(), event(1, { kind: "turn_started", turn: 1 }));
    const changed = reduceEnvelope(state, event(1, { kind: "turn_started", turn: 2 }, 2));
    expect(changed.result).toBe("resync_required");
    expect(changed.state.run).toEqual({ thinking: { turn: 1, step: 0 } });
    expect(changed.state.delivery.awaitingSnapshot).toBe(true);

    state = reduceEnvelope(
      changed.state,
      response({ kind: "snapshot", connection_epoch: 2, snapshot: desktopSnapshot() }, 2),
    ).state;
    const accepted = reduceEnvelope(state, event(1, { kind: "turn_started", turn: 2 }, 2));
    expect(accepted.result).toBe("applied");
    expect(accepted.state.run).toEqual({ thinking: { turn: 2, step: 0 } });
  });

  it("returns to idle when TurnCompleted has no following StateChanged", () => {
    let state = apply(
      createRenderState(),
      event(1, { kind: "state_changed", state: { thinking: { turn: 1, step: 0 } } }),
    );
    state = apply(state, event(2, { kind: "turn_completed", turn: 1 }));
    expect(state.run).toBe("idle");
  });

  it("projects tool, approval, result, and failure facts by canonical identity", () => {
    const toolCall = call("call-1");
    let state = apply(
      createRenderState(),
      event(1, { kind: "tool_call", turn: 1, call: toolCall }),
    );
    state = apply(
      state,
      event(2, {
        kind: "approval_requested",
        request: { id: "approval-1", turn: 1, call: toolCall, working_dir: "." },
      }),
    );
    expect(state.approvals["approval-1"]).toBeDefined();
    expect(state.run).toEqual({
      waiting_approval: { turn: 1, request_id: "approval-1" },
    });

    state = reduceEnvelope(
      state,
      response({ kind: "approval_accepted", approval_id: "approval-1" }),
    ).state;
    expect(state.approvals).toEqual({});
    state = apply(
      state,
      event(3, { kind: "tool_result", turn: 1, result: result(toolCall) }),
    );
    expect(state.tools["call-1"]?.result).not.toBeNull();

    state = apply(
      state,
      event(4, {
        kind: "turn_failed",
        turn: 1,
        error: { kind: "tool", message: "tool failed after approval", recoverable: true },
      }),
    );
    expect(state.run).toEqual({
      failed: {
        turn: 1,
        error: { kind: "tool", message: "tool failed after approval", recoverable: true },
      },
    });
    expect(state.notices.some((notice) => notice.errorKind === "tool")).toBe(true);
  });

  it("preserves command-error recoverability without changing run facts", () => {
    let state = reduceEnvelope(
      createRenderState(),
      response({
        kind: "rejected",
        error: { code: "invalid_input", message: "empty" },
      }),
    ).state;
    state = reduceEnvelope(
      state,
      response({ kind: "rejected", error: { code: "stopped", message: "stopped" } }),
    ).state;
    expect(state.notices).toEqual([
      { kind: "error", message: "empty", recoverable: true, errorKind: null },
      { kind: "error", message: "stopped", recoverable: false, errorKind: null },
    ]);
    expect(state.run).toBe("starting");
  });
});
