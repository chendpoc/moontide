import type {
  ApprovalRequest,
  ContentBlock,
  DesktopCommandError,
  DesktopError,
  DesktopMessageEnvelope,
  DesktopRunState,
  DesktopSnapshot,
  ModelResponseSnapshot,
  ResyncReason,
  SessionSnapshot,
  ShutdownReport,
  ToolCall,
  ToolResult,
} from "$lib/protocol/index.js";

export type MessageView =
  | { kind: "user"; turn: number; text: string }
  | { kind: "assistant"; turn: number; blocks: ContentBlock[] }
  | { kind: "tool_call"; turn: number; call: ToolCall }
  | { kind: "tool_result"; turn: number; result: ToolResult };

export interface AssistantDraftView {
  turn: number;
  step: number;
  llmCallId: string;
  updateIndex: number;
  snapshot: ModelResponseSnapshot;
}

export interface ToolView {
  turn: number;
  call: ToolCall;
  result: ToolResult | null;
}

export interface ApprovalView {
  request: ApprovalRequest;
}

export type NoticeKind = "error" | "resync" | "stopped";

export interface NoticeView {
  kind: NoticeKind;
  message: string;
  recoverable: boolean;
  errorKind: DesktopError["kind"] | null;
  turn?: number | null;
}

export interface DeliveryView {
  connectionEpoch: number | null;
  lastSeq: number | null;
  awaitingSnapshot: boolean;
  resyncRequired: boolean;
  droppedSnapshots: number;
  bufferedEvents: number;
  resyncReason: ResyncReason | null;
}

export interface LiveAnnouncementView {
  id: string;
  kind: "approval_required";
  toolName: string;
}

export interface RenderState {
  session: SessionSnapshot | null;
  historyExpanded: boolean;
  run: DesktopRunState;
  messages: MessageView[];
  assistantDrafts: Record<string, AssistantDraftView>;
  tools: Record<string, ToolView>;
  approvals: Record<string, ApprovalView>;
  notices: NoticeView[];
  liveAnnouncement: LiveAnnouncementView | null;
  delivery: DeliveryView;
  stoppedReport: ShutdownReport | null;
  finalizedCalls: Set<string>;
}

export type RenderFoldResult = "applied" | "ignored" | "resync_required";

export interface RenderFoldOutput {
  state: RenderState;
  result: RenderFoldResult;
}

export function createRenderState(): RenderState {
  return {
    session: null,
    historyExpanded: false,
    run: "starting",
    messages: [],
    assistantDrafts: {},
    tools: {},
    approvals: {},
    notices: [],
    liveAnnouncement: null,
    delivery: {
      connectionEpoch: null,
      lastSeq: null,
      awaitingSnapshot: false,
      resyncRequired: false,
      droppedSnapshots: 0,
      bufferedEvents: 0,
      resyncReason: null,
    },
    stoppedReport: null,
    finalizedCalls: new Set(),
  };
}

export function reduceEnvelope(
  current: RenderState,
  envelope: DesktopMessageEnvelope,
): RenderFoldOutput {
  const state = cloneState(current);
  switch (envelope.payload.kind) {
    case "command":
      return { state: current, result: "ignored" };
    case "response":
      return reduceResponse(state, envelope.connection_epoch, envelope.payload.response);
    case "event":
      return reduceEvent(
        state,
        envelope.connection_epoch,
        envelope.seq,
        envelope.payload.event,
      );
  }
}

export function reduceLiveEnvelope(
  current: RenderState,
  envelope: DesktopMessageEnvelope,
): RenderFoldOutput {
  const output = reduceEnvelope(current, envelope);
  if (
    output.result === "applied" &&
    envelope.payload.kind === "event" &&
    envelope.payload.event.kind === "approval_requested"
  ) {
    output.state.liveAnnouncement = {
      id: `${envelope.connection_epoch ?? "unknown"}:${envelope.seq ?? "unknown"}:${envelope.payload.event.request.id}`,
      kind: "approval_required",
      toolName: envelope.payload.event.request.call.name,
    };
  }
  return output;
}

function reduceResponse(
  state: RenderState,
  epoch: number | null,
  response: Extract<DesktopMessageEnvelope["payload"], { kind: "response" }>["response"],
): RenderFoldOutput {
  switch (response.kind) {
    case "session_ready":
    case "snapshot":
      return {
        state: replaceSnapshot(state, response.snapshot, epoch),
        result: "applied",
      };
    case "session_history_page": {
      if (state.session?.summary.session_id !== response.session_id) {
        return { state, result: "ignored" };
      }
      state.session = {
        ...state.session,
        items: mergeSessionItems(state.session.items, response.items),
        history: {
          oldest_turn: response.oldest_turn,
          has_older: response.has_older,
        },
      };
      state.historyExpanded = true;
      const projected = projectSession(state.session);
      state.messages = projected.messages;
      state.tools = projected.tools;
      return { state, result: "applied" };
    }
    case "approval_accepted":
      delete state.approvals[response.approval_id];
      return { state, result: "applied" };
    case "shutdown_completed":
      state.run = "stopped";
      state.stoppedReport = response.report;
      return { state, result: "applied" };
    case "rejected":
      state.notices.push({
        kind: "error",
        message: response.error.message,
        recoverable: commandErrorRecoverable(response.error.code),
        errorKind: null,
      });
      return { state, result: "applied" };
    case "handshake_accepted":
    case "session_catalog_listed":
    case "generation_ready":
    case "turn_accepted":
    case "cancellation_accepted":
      return { state, result: "ignored" };
  }
}

function reduceEvent(
  state: RenderState,
  epoch: number | null,
  seq: number | null,
  event: Extract<DesktopMessageEnvelope["payload"], { kind: "event" }>["event"],
): RenderFoldOutput {
  const identity = acceptEventIdentity(state, epoch, seq);
  if (identity !== null) {
    return identity;
  }

  switch (event.kind) {
    case "turn_started":
      state.run = { thinking: { turn: event.turn, step: 0 } };
      break;
    case "llm_call_started":
      state.run = { thinking: { turn: event.turn, step: event.step } };
      break;
    case "assistant_response_snapshot": {
      const key = assistantDraftKey(event.turn, event.llm_call_id);
      if (state.finalizedCalls.has(key)) {
        return { state, result: "ignored" };
      }
      const previous = state.assistantDrafts[key];
      if (previous !== undefined && event.update_index <= previous.updateIndex) {
        return { state, result: "ignored" };
      }
      state.assistantDrafts[key] = {
        turn: event.turn,
        step: event.step,
        llmCallId: event.llm_call_id,
        updateIndex: event.update_index,
        snapshot: event.snapshot,
      };
      break;
    }
    case "tool_call":
      state.run = {
        running_tool: {
          turn: event.turn,
          tool_use_id: event.call.tool_use_id,
          name: event.call.name,
        },
      };
      state.tools[event.call.tool_use_id] = {
        turn: event.turn,
        call: event.call,
        result: null,
      };
      break;
    case "tool_result": {
      const tool = state.tools[event.result.tool_use_id];
      if (tool === undefined || tool.call.name !== event.result.name) {
        return requestResync(state, "event_gap");
      }
      tool.result = event.result;
      break;
    }
    case "assistant_finalized": {
      const key = assistantDraftKey(event.turn, event.llm_call_id);
      if (state.finalizedCalls.has(key)) {
        return { state, result: "ignored" };
      }
      delete state.assistantDrafts[key];
      state.messages.push({ kind: "assistant", turn: event.turn, blocks: event.blocks });
      state.finalizedCalls.add(key);
      break;
    }
    case "approval_requested":
      state.approvals[event.request.id] = { request: event.request };
      state.run = {
        waiting_approval: { turn: event.request.turn, request_id: event.request.id },
      };
      break;
    case "state_changed":
      state.run = event.state;
      break;
    case "turn_failed":
      state.run = { failed: { turn: event.turn, error: event.error } };
      addErrorNotice(state, event.error, event.turn);
      break;
    case "resync_required":
      return requestResync(state, event.reason);
    case "stopped":
      state.run = "stopped";
      state.stoppedReport = event.report;
      state.notices.push({
        kind: "stopped",
        message: "desktop host stopped",
        recoverable: false,
        errorKind: null,
      });
      break;
    case "turn_completed":
      state.run = "idle";
      break;
    case "llm_call_ended":
    case "turn_ended":
      break;
  }

  return { state, result: "applied" };
}

function acceptEventIdentity(
  state: RenderState,
  epoch: number | null,
  seq: number | null,
): RenderFoldOutput | null {
  if (epoch !== null) {
    const currentEpoch = state.delivery.connectionEpoch;
    if (currentEpoch !== null) {
      if (epoch < currentEpoch) {
        return { state, result: "ignored" };
      }
      if (epoch > currentEpoch) {
        state.delivery.connectionEpoch = epoch;
        state.delivery.lastSeq = null;
        state.delivery.awaitingSnapshot = true;
        return requestResync(state, "explicit_request");
      }
    } else {
      state.delivery.connectionEpoch = epoch;
    }
  }

  if (state.delivery.awaitingSnapshot) {
    return requestResync(state, "explicit_request");
  }
  if (seq === null) {
    return requestResync(state, "event_gap");
  }

  const lastSeq = state.delivery.lastSeq;
  if (lastSeq !== null) {
    if (seq <= lastSeq) {
      return { state, result: "ignored" };
    }
    if (seq !== lastSeq + 1) {
      return requestResync(state, "event_gap");
    }
  }
  state.delivery.lastSeq = seq;
  return null;
}

function replaceSnapshot(
  state: RenderState,
  snapshot: DesktopSnapshot,
  epoch: number | null,
): RenderState {
  const sameSession = state.session?.summary.session_id === snapshot.session.summary.session_id;
  const session = mergeSnapshotWindow(
    state.session,
    snapshot.session,
    state.historyExpanded,
  );
  const projected = projectSession(session);
  const activeCalls = new Set(
    snapshot.active_assistant_calls.map((call) => assistantDraftKey(call.turn, call.llm_call_id)),
  );
  const assistantDrafts = Object.fromEntries(
    Object.entries(state.assistantDrafts).filter(([key]) => activeCalls.has(key)),
  );

  state.session = session;
  state.historyExpanded = sameSession ? state.historyExpanded : false;
  state.run = snapshot.state;
  state.messages = projected.messages;
  state.tools = projected.tools;
  state.approvals = Object.fromEntries(
    snapshot.pending_approvals.map((request) => [request.id, { request }]),
  );
  state.liveAnnouncement = null;
  state.assistantDrafts = assistantDrafts;
  state.finalizedCalls = new Set();
  state.stoppedReport = null;
  state.delivery = {
    connectionEpoch: epoch ?? state.delivery.connectionEpoch,
    lastSeq: snapshot.delivery.last_delivered_seq,
    awaitingSnapshot: false,
    resyncRequired: false,
    droppedSnapshots: snapshot.delivery.dropped_snapshots,
    bufferedEvents: snapshot.delivery.buffered_events,
    resyncReason: null,
  };
  state.notices = state.notices.filter((notice) => notice.kind !== "resync");
  if (typeof snapshot.state !== "string" && "failed" in snapshot.state) {
    addErrorNotice(state, snapshot.state.failed.error, snapshot.state.failed.turn);
  }
  return state;
}

function mergeSnapshotWindow(
  current: SessionSnapshot | null,
  snapshot: SessionSnapshot,
  historyExpanded: boolean,
): SessionSnapshot {
  if (!historyExpanded || current?.summary.session_id !== snapshot.summary.session_id) {
    return snapshot;
  }
  const currentOldest = current.history.oldest_turn;
  const snapshotOldest = snapshot.history.oldest_turn;
  if (currentOldest === null || snapshotOldest === null || currentOldest >= snapshotOldest) {
    return snapshot;
  }
  return {
    ...snapshot,
    items: mergeSessionItems(current.items, snapshot.items),
    history: {
      oldest_turn: currentOldest,
      has_older: current.history.has_older,
    },
  };
}

function mergeSessionItems(
  current: SessionSnapshot["items"],
  incoming: SessionSnapshot["items"],
): SessionSnapshot["items"] {
  const items = new Map(current.map((item) => [item.base.id, item]));
  for (const item of incoming) {
    items.set(item.base.id, item);
  }
  return [...items.values()].sort((left, right) => left.base.seq - right.base.seq);
}

function projectSession(session: SessionSnapshot): {
  messages: MessageView[];
  tools: Record<string, ToolView>;
} {
  const messages: MessageView[] = [];
  const tools: Record<string, ToolView> = {};
  for (const item of session.items) {
    switch (item.kind) {
      case "user_message":
        messages.push({ kind: "user", turn: item.base.turn, text: item.text });
        break;
      case "assistant_message":
        messages.push({ kind: "assistant", turn: item.base.turn, blocks: item.blocks });
        break;
      case "tool_call":
        tools[item.call.tool_use_id] = {
          turn: item.base.turn,
          call: item.call,
          result: null,
        };
        messages.push({ kind: "tool_call", turn: item.base.turn, call: item.call });
        break;
      case "tool_result": {
        const tool = tools[item.result.tool_use_id];
        if (tool !== undefined) {
          tool.result = item.result;
        }
        messages.push({ kind: "tool_result", turn: item.base.turn, result: item.result });
        break;
      }
      case "compaction":
      case "checkpoint_created":
        break;
    }
  }
  return { messages, tools };
}

function requestResync(state: RenderState, reason: ResyncReason): RenderFoldOutput {
  state.delivery.resyncRequired = true;
  state.delivery.resyncReason = reason;
  if (!state.notices.some((notice) => notice.kind === "resync")) {
    state.notices.push({
      kind: "resync",
      message: `desktop state requires resync: ${reason}`,
      recoverable: true,
      errorKind: null,
    });
  }
  return { state, result: "resync_required" };
}

function errorNotice(error: DesktopError, turn: number | null): NoticeView {
  return {
    kind: "error",
    message: error.message,
    recoverable: error.recoverable,
    errorKind: error.kind,
    turn,
  };
}

function addErrorNotice(state: RenderState, error: DesktopError, turn: number | null): void {
  const notice = errorNotice(error, turn);
  const existing = state.notices.findIndex(
    (current) =>
      current.kind === notice.kind &&
      current.message === notice.message &&
      current.errorKind === notice.errorKind &&
      current.turn === notice.turn,
  );
  if (existing === -1) {
    state.notices.push(notice);
  } else {
    state.notices[existing] = notice;
  }
}

function commandErrorRecoverable(code: DesktopCommandError["code"]): boolean {
  return !UNRECOVERABLE_COMMAND_ERROR_CODES.has(code);
}

const UNRECOVERABLE_COMMAND_ERROR_CODES = new Set<DesktopCommandError["code"]>([
  "protocol_version_unsupported",
  "handshake_required",
  "session_not_started",
  "session_already_started",
  "stopping",
  "stopped",
  "event_stream_closed",
  "internal",
]);

function assistantDraftKey(turn: number, llmCallId: string): string {
  return `${turn}:${llmCallId}`;
}

function cloneState(state: RenderState): RenderState {
  return {
    ...state,
    messages: [...state.messages],
    assistantDrafts: { ...state.assistantDrafts },
    tools: Object.fromEntries(
      Object.entries(state.tools).map(([key, tool]) => [key, { ...tool }]),
    ),
    approvals: { ...state.approvals },
    notices: [...state.notices],
    delivery: { ...state.delivery },
    finalizedCalls: new Set(state.finalizedCalls),
  };
}
