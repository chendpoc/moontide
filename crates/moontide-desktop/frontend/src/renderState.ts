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
} from "./protocol";

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

export interface RenderState {
  session: SessionSnapshot | null;
  run: DesktopRunState;
  messages: MessageView[];
  assistantDrafts: Record<string, AssistantDraftView>;
  tools: Record<string, ToolView>;
  approvals: Record<string, ApprovalView>;
  notices: NoticeView[];
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
    run: "starting",
    messages: [],
    assistantDrafts: {},
    tools: {},
    approvals: {},
    notices: [],
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
      state.notices.push(errorNotice(event.error));
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
  const projected = projectSession(snapshot.session);
  const activeCalls = new Set(
    snapshot.active_assistant_calls.map((call) => assistantDraftKey(call.turn, call.llm_call_id)),
  );
  const hadDroppedDraft = Object.keys(state.assistantDrafts).some((key) => !activeCalls.has(key));
  const assistantDrafts = Object.fromEntries(
    Object.entries(state.assistantDrafts).filter(([key]) => activeCalls.has(key)),
  );

  state.session = snapshot.session;
  state.run = snapshot.state;
  state.messages = projected.messages;
  state.tools = projected.tools;
  state.approvals = Object.fromEntries(
    snapshot.pending_approvals.map((request) => [request.id, { request }]),
  );
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
  if (hadDroppedDraft) {
    state.notices.push({
      kind: "resync",
      message: "resync removed an assistant draft whose call was no longer active",
      recoverable: true,
      errorKind: null,
    });
  }
  return state;
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

function errorNotice(error: DesktopError): NoticeView {
  return {
    kind: "error",
    message: error.message,
    recoverable: error.recoverable,
    errorKind: error.kind,
  };
}

function commandErrorRecoverable(code: DesktopCommandError["code"]): boolean {
  return ![
    "protocol_version_unsupported",
    "handshake_required",
    "session_not_started",
    "session_already_started",
    "stopping",
    "stopped",
    "event_stream_closed",
    "internal",
  ].includes(code);
}

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
