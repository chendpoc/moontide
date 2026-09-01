import type {
  ContentBlock,
  DesktopRunState,
  ModelResponseSnapshot,
  ToolCall,
  ToolResult,
} from "$lib/protocol/index.js";
import type {
  AssistantDraftView,
  LiveAnnouncementView,
  MessageView,
  NoticeView,
  RenderState,
  ToolView,
} from "$lib/projection/renderState.js";
import type {
  ConnectionState,
  DesktopViewState,
  SessionCatalogState,
} from "$lib/controller/index.js";

export type CommandPhase = "idle" | "submitting" | "cancelling" | "approval";
export type ComposerMode = "editable" | "active" | "submitting" | "cancelling" | "disabled";
export type ChatPageMode = "blank" | "loaded";

export type ChatUiModel =
  | { page: "blank"; sessionId: null }
  | { page: "loaded"; sessionId: string };

export interface SessionListRowModel {
  sessionId: string;
  excerpt: string | null;
  lastActivityAt: string | null;
  selected: boolean;
}

export interface SessionListUiModel {
  status: SessionCatalogState["kind"];
  rows: SessionListRowModel[];
  error: string | null;
}

export type AssistantDisplayBlock = ContentBlock;
export type AssistantPendingBlock = ModelResponseSnapshot["pending"];

export type ConversationItem =
  | { kind: "user"; key: string; turn: number; text: string }
  | { kind: "assistant"; key: string; turn: number; blocks: ContentBlock[] }
  | {
      kind: "tool";
      key: string;
      turn: number;
      call: ToolCall;
      result: ToolResult | null;
    };

export type ToolStatusTone = "neutral" | "success" | "warning" | "danger";

export interface ToolStatusModel {
  label: string;
  tone: ToolStatusTone;
}

export function chatUiModel(state: RenderState): ChatUiModel {
  const session = state.session;
  return session === null
    ? { page: "blank", sessionId: null }
    : { page: "loaded", sessionId: session.summary.session_id };
}

export function sessionListModel(catalog: SessionCatalogState): SessionListUiModel {
  return {
    status: catalog.kind,
    rows: catalog.rows.map((row) => ({
      sessionId: row.session_id,
      excerpt: row.first_user_message_excerpt,
      lastActivityAt: row.last_activity_at,
      selected: row.loaded,
    })),
    error: catalog.kind === "failed" ? catalog.message : null,
  };
}

export function runStateKind(run: DesktopRunState): string {
  if (typeof run === "string") {
    return run;
  }
  return Object.keys(run)[0] ?? "unknown";
}

export function runStateLabel(run: DesktopRunState): string {
  if (typeof run === "string") {
    return RUN_STATE_STRING_LABEL[run] ?? capitalize(run);
  }
  const key = Object.keys(run)[0];
  if (key === undefined) {
    return "Unknown";
  }
  return RUN_STATE_OBJECT_LABEL[key]?.(run as never) ?? "Unknown";
}

interface ComposerModeInput {
  connection: ConnectionState;
  page: ChatPageMode;
  run: DesktopRunState;
  phase: CommandPhase;
}

const COMPOSER_MODE_RULES: ReadonlyArray<{
  when: (input: ComposerModeInput) => boolean;
  mode: ComposerMode;
}> = [
  { when: (input) => input.connection.kind !== "ready", mode: "disabled" },
  { when: (input) => input.phase === "cancelling", mode: "cancelling" },
  { when: (input) => input.phase === "submitting", mode: "submitting" },
  { when: (input) => input.page === "blank", mode: "editable" },
  {
    when: (input) => LOADED_EDITABLE_RUNS.has(runStateKind(input.run)),
    mode: "editable",
  },
  {
    when: (input) => LOADED_ACTIVE_RUNS.has(runStateKind(input.run)),
    mode: "active",
  },
  {
    when: (input) => LOADED_CANCELLING_RUNS.has(runStateKind(input.run)),
    mode: "cancelling",
  },
];

export function composerMode(
  connection: ConnectionState,
  page: ChatPageMode,
  run: DesktopRunState,
  phase: CommandPhase,
): ComposerMode {
  const input: ComposerModeInput = { connection, page, run, phase };
  return COMPOSER_MODE_RULES.find((rule) => rule.when(input))?.mode ?? "disabled";
}

const APPROVAL_BLOCKED_PHASES = new Set<CommandPhase>(["approval", "cancelling"]);

export function allowsApproval(
  connection: ConnectionState,
  run: DesktopRunState,
  phase: CommandPhase,
  pendingApprovalCount = 0,
): boolean {
  if (connection.kind !== "ready" || APPROVAL_BLOCKED_PHASES.has(phase)) {
    return false;
  }
  return (
    runStateKind(run) === "waiting_approval" || pendingApprovalCount > 0
  );
}

export function allowsSessionTransition(state: DesktopViewState): boolean {
  return sessionTransitionBlockReason(state) === null;
}

export interface LifecycleOverlayContext {
  historyLoading: boolean;
  lifecycleTarget: "new" | string | null;
  phase: CommandPhase;
}

const SESSION_SWITCH_OVERLAY_RULES: ReadonlyArray<{
  when: (overlay: LifecycleOverlayContext) => boolean;
  message: string;
}> = [
  {
    when: (overlay) => overlay.historyLoading,
    message: "Wait for earlier messages to finish loading before changing Sessions.",
  },
  {
    when: (overlay) => overlay.lifecycleTarget !== null,
    message: "A Session change is already in progress.",
  },
  {
    when: (overlay) => overlay.phase !== "idle",
    message: "Wait for the current action to finish before switching Sessions.",
  },
];

const HISTORY_LOAD_OVERLAY_RULES: ReadonlyArray<{
  when: (overlay: LifecycleOverlayContext) => boolean;
  message: string;
}> = [
  {
    when: (overlay) => overlay.lifecycleTarget !== null,
    message: "Wait for the Session change to finish before loading earlier messages.",
  },
  {
    when: (overlay) => overlay.phase !== "idle",
    message: "Wait for the current action to finish before loading earlier messages.",
  },
];

export function sessionTransitionReason(
  view: DesktopViewState,
  overlay: LifecycleOverlayContext,
): string | null {
  const overlayRule = SESSION_SWITCH_OVERLAY_RULES.find((rule) => rule.when(overlay));
  if (overlayRule !== undefined) {
    return overlayRule.message;
  }
  return sessionTransitionBlockReason(view);
}

export function historyLoadReason(
  view: DesktopViewState,
  overlay: LifecycleOverlayContext,
): string | null {
  const overlayRule = HISTORY_LOAD_OVERLAY_RULES.find((rule) => rule.when(overlay));
  if (overlayRule !== undefined) {
    return overlayRule.message;
  }
  return historyLoadBlockReason(view);
}

type LifecycleGateAction = "session_switch" | "load_history";

interface LifecycleGateContext {
  connectionKind: ConnectionState["kind"];
  runKind: string;
  pendingApprovalCount: number;
  firstSendIdle: boolean;
  deliverySettled: boolean;
}

const LIFECYCLE_GATE_RULES: ReadonlyArray<{
  when: (context: LifecycleGateContext) => boolean;
  messages: Record<LifecycleGateAction, string>;
}> = [
  {
    when: (context) => context.connectionKind === "starting",
    messages: {
      session_switch:
        "Wait for MoonTide to finish starting before changing Sessions.",
      load_history:
        "Wait for MoonTide to finish starting before loading earlier messages.",
    },
  },
  {
    when: (context) => context.connectionKind !== "ready",
    messages: {
      session_switch: "Reconnect MoonTide before changing Sessions.",
      load_history: "Reconnect MoonTide before loading earlier messages.",
    },
  },
  {
    when: (context) =>
      context.pendingApprovalCount > 0 || context.runKind === "waiting_approval",
    messages: {
      session_switch: "Resolve the pending approval before changing Sessions.",
      load_history:
        "Resolve the pending approval before loading earlier messages.",
    },
  },
  {
    when: (context) => isBusyTurnRun(context.runKind),
    messages: {
      session_switch: "Finish or stop the current turn before changing Sessions.",
      load_history:
        "Finish or stop the current turn before loading earlier messages.",
    },
  },
  {
    when: (context) => !context.firstSendIdle,
    messages: {
      session_switch:
        "Wait for the first message to finish starting its Session.",
      load_history:
        "Wait for the first message to finish before loading earlier messages.",
    },
  },
  {
    when: (context) => !context.deliverySettled,
    messages: {
      session_switch: "Wait for MoonTide to finish syncing before changing Sessions.",
      load_history:
        "Wait for MoonTide to finish syncing before loading earlier messages.",
    },
  },
];

function lifecycleGateContext(state: DesktopViewState): LifecycleGateContext {
  return {
    connectionKind: state.connection.kind,
    runKind: runStateKind(state.render.run),
    pendingApprovalCount: Object.keys(state.render.approvals).length,
    firstSendIdle: state.firstSend.kind === "idle",
    deliverySettled:
      !state.render.delivery.awaitingSnapshot &&
      !state.render.delivery.resyncRequired,
  };
}

function lifecycleBlockReason(
  state: DesktopViewState,
  action: LifecycleGateAction,
): string | null {
  const context = lifecycleGateContext(state);
  const rule = LIFECYCLE_GATE_RULES.find((entry) => entry.when(context));
  return rule === undefined ? null : rule.messages[action];
}

export function sessionTransitionBlockReason(state: DesktopViewState): string | null {
  return lifecycleBlockReason(state, "session_switch");
}

export function historyLoadBlockReason(state: DesktopViewState): string | null {
  return lifecycleBlockReason(state, "load_history");
}

export function isSessionCloseSettled(
  state: DesktopViewState,
  options: { turnSubmissionPending?: boolean } = {},
): boolean {
  const context = lifecycleGateContext(state);
  if (context.connectionKind !== "ready") {
    return false;
  }
  if (!["idle", "failed"].includes(context.runKind)) {
    return false;
  }
  if (context.pendingApprovalCount > 0) {
    return false;
  }
  if (!context.firstSendIdle) {
    return false;
  }
  if (!context.deliverySettled) {
    return false;
  }
  if (options.turnSubmissionPending) {
    return false;
  }
  return true;
}

export const UNTITLED_SESSION_LABEL = "Untitled session";

const REPLY_DIDNT_FINISH = "The reply didn't finish. Try again.";
const MOONTIDE_STOPPED = "This window is no longer connected.";
const CONNECTION_LOST = "MoonTide disconnected. Retry to continue.";
const CATALOG_LOAD_FAILED = "Couldn't load recent conversations.";
const HISTORY_LOAD_FAILED = "Couldn't load earlier messages.";
const ACTION_FAILED = "That action didn't complete. Try again.";

export interface NoticePresentation {
  title: string;
  description: string;
}

export function sessionExcerptLabel(excerpt: string | null): string {
  return excerpt ?? UNTITLED_SESSION_LABEL;
}

export function connectionPresentation(
  connection: ConnectionState,
): NoticePresentation | null {
  return CONNECTION_PRESENTATION[connection.kind] ?? null;
}

export function catalogErrorCopy(_message: string | null): string {
  return CATALOG_LOAD_FAILED;
}

export function historyErrorCopy(_message: string | null): string {
  return HISTORY_LOAD_FAILED;
}

export function actionErrorCopy(_message: string | null): string {
  return ACTION_FAILED;
}

export const CONNECTION_ANNOUNCEMENT: Record<ConnectionState["kind"], string> = {
  starting: "MoonTide is starting",
  ready: "MoonTide is ready",
  degraded: "MoonTide connection unavailable",
  disconnected: "MoonTide connection unavailable",
};

export function connectionAnnouncement(kind: ConnectionState["kind"]): string {
  return CONNECTION_ANNOUNCEMENT[kind];
}

export type ComposerAlertKind = "starting" | "action_failed";

export const COMPOSER_ALERT_PRESENTATION: Record<
  ComposerAlertKind,
  Pick<NoticePresentation, "title"> & { description?: string }
> = {
  starting: {
    title: "Starting MoonTide",
    description: "Sending will be available shortly.",
  },
  action_failed: {
    title: "Action failed",
  },
};

export function composerAlertPresentation(kind: ComposerAlertKind): NoticePresentation {
  const presentation = COMPOSER_ALERT_PRESENTATION[kind];
  return {
    title: presentation.title,
    description: presentation.description ?? "",
  };
}

export function liveAnnouncementPresentation(announcement: LiveAnnouncementView): string {
  switch (announcement.kind) {
    case "approval_required":
      return `Approval required for ${announcement.toolName}`;
  }
}

// Resync notices only belong on the reading surface while delivery is still catching up.
// A completed snapshot already replaced Host facts; leftover protocol notices stay out of chat.
export function visibleConversationNotices(
  state: RenderState,
  connection: ConnectionState = { kind: "ready" },
): NoticeView[] {
  return state.notices.filter((notice) => {
    if (notice.kind !== "resync") {
      return true;
    }
    if (connection.kind === "degraded" || connection.kind === "disconnected") {
      return false;
    }
    return state.delivery.resyncRequired || state.delivery.awaitingSnapshot;
  });
}

export function noticePresentation(notice: NoticeView): NoticePresentation {
  if (notice.kind === "error") {
    if (notice.errorKind === "provider" || notice.errorKind === "tool") {
      return {
        title: ERROR_NOTICE_TITLE,
        description: notice.message,
      };
    }
    return {
      title: ERROR_NOTICE_TITLE,
      description: REPLY_DIDNT_FINISH,
    };
  }
  return NOTICE_PRESENTATION[notice.kind];
}

export function conversationItems(state: RenderState): ConversationItem[] {
  const items: ConversationItem[] = [];
  const toolIndexes = new Map<string, number>();

  state.messages.forEach((message, index) => {
    switch (message.kind) {
      case "user":
        items.push({
          kind: "user",
          key: `user:${message.turn}:${index}`,
          turn: message.turn,
          text: message.text,
        });
        break;
      case "assistant":
        items.push({
          kind: "assistant",
          key: `assistant:${message.turn}:${index}`,
          turn: message.turn,
          blocks: message.blocks,
        });
        break;
      case "tool_call":
        toolIndexes.set(message.call.tool_use_id, items.length);
        items.push({
          kind: "tool",
          key: `tool:${message.call.tool_use_id}`,
          turn: message.turn,
          call: message.call,
          result: null,
        });
        break;
      case "tool_result": {
        const toolIndex = toolIndexes.get(message.result.tool_use_id);
        if (toolIndex !== undefined) {
          const tool = items[toolIndex];
          if (tool?.kind === "tool" && tool.call.name === message.result.name) {
            items[toolIndex] = { ...tool, result: message.result };
          }
        }
        break;
      }
    }
  });

  return items;
}

export function contentBlockDisplayText(content: string | ContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return blocksText(content, "display");
}

export function blocksText(
  blocks: ContentBlock[],
  mode: "copy" | "display" = "copy",
): string {
  return blocks
    .flatMap((block) => blockDisplayLines(block, mode))
    .filter((text) => text.length > 0)
    .join("\n");
}

function blockDisplayLines(block: ContentBlock, mode: "copy" | "display"): string[] {
  switch (block.kind) {
    case "text":
      return [block.text];
    case "thinking":
      return [];
    case "tool_use":
      return mode === "display"
        ? [`Tool call · ${block.name}`]
        : [`tool: ${block.name}`];
    case "tool_result":
      return mode === "display"
        ? [contentBlockDisplayText(block.content)]
        : ["tool result"];
  }
}

export function snapshotText(snapshot: ModelResponseSnapshot): string {
  const visible = blocksText(snapshot.content);
  const pending = snapshot.pending;
  if (pending === null || pending.kind === "thinking") {
    return visible;
  }
  const pendingText =
    pending.kind === "text" ? pending.text : `tool: ${pending.name}`;
  return [visible, pendingText].filter((text) => text.length > 0).join("\n");
}

export function assistantCopyText(
  blocks: ContentBlock[],
  pending: AssistantPendingBlock = null,
): string {
  const committed = blocksText(blocks);
  if (pending === null || pending.kind === "thinking") {
    return committed;
  }
  const pendingText =
    pending.kind === "text" ? pending.text : `tool: ${pending.name}`;
  return [committed, pendingText].filter((text) => text.length > 0).join("\n");
}

export function displayJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "null";
}

export function toolResultContentText(result: ToolResult): string {
  return "text" in result.content
    ? result.content.text
    : displayJson(result.content.json);
}

export function orderedDrafts(state: RenderState): AssistantDraftView[] {
  return Object.values(state.assistantDrafts).sort(
    (left, right) =>
      left.turn - right.turn ||
      left.step - right.step ||
      left.llmCallId.localeCompare(right.llmCallId),
  );
}

export function liveTools(state: RenderState): ToolView[] {
  const historical = new Set(
    state.messages.flatMap((message: MessageView) => {
      if (message.kind === "tool_call") {
        return [message.call.tool_use_id];
      }
      if (message.kind === "tool_result") {
        return [message.result.tool_use_id];
      }
      return [];
    }),
  );
  return Object.values(state.tools).filter(
    (tool) => !historical.has(tool.call.tool_use_id),
  );
}

export function toolStatusLabel(result: ToolResult | null): string {
  return toolStatusModel(result).label;
}

export function toolStatusModel(result: ToolResult | null): ToolStatusModel {
  if (result === null) {
    return TOOL_STATUS.running;
  }
  if (typeof result.status === "string") {
    return TOOL_STRING_STATUS[result.status] ?? TOOL_STATUS.running;
  }
  if ("failed" in result.status) {
    return TOOL_STATUS.failed;
  }
  return TOOL_STATUS.cancelled;
}

const RUN_STATE_STRING_LABEL: Record<string, string> = {
  idle: "Idle",
  failed: "Failed",
  starting: "Starting",
  stopping: "Stopping",
  stopped: "Stopped",
};

const RUN_STATE_OBJECT_LABEL: Record<
  string,
  (run: DesktopRunState & object) => string
> = {
  thinking: (run) =>
    "thinking" in run
      ? `Thinking · turn ${run.thinking.turn} · step ${run.thinking.step}`
      : "Unknown",
  running_tool: (run) =>
    "running_tool" in run ? `Running ${run.running_tool.name}` : "Unknown",
  waiting_approval: () => "Waiting for approval",
  cancelling: () => "Cancelling",
  failed: () => "Failed",
};

const LOADED_EDITABLE_RUNS = new Set(["idle", "failed"]);
const LOADED_ACTIVE_RUNS = new Set(["thinking", "running_tool", "waiting_approval"]);
const LOADED_CANCELLING_RUNS = new Set(["cancelling", "stopping"]);

const CONNECTION_PRESENTATION: Partial<
  Record<ConnectionState["kind"], NoticePresentation>
> = {
  degraded: {
    title: "Connection lost",
    description: CONNECTION_LOST,
  },
  disconnected: {
    title: "Connection lost",
    description: CONNECTION_LOST,
  },
};

const ERROR_NOTICE_TITLE = "Reply didn't finish";

const NOTICE_PRESENTATION: Record<
  Exclude<NoticeView["kind"], "error">,
  NoticePresentation
> = {
  resync: {
    title: "Updating conversation",
    description: "Live updates were interrupted. Restoring the latest state.",
  },
  stopped: {
    title: "MoonTide stopped",
    description: MOONTIDE_STOPPED,
  },
};

const TOOL_STATUS = {
  running: { label: "Running", tone: "neutral" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "warning" },
} as const satisfies Record<string, ToolStatusModel>;

const TOOL_STRING_STATUS: Record<string, ToolStatusModel> = {
  succeeded: { label: "Succeeded", tone: "success" },
  invalid_arguments: { label: "Invalid arguments", tone: "danger" },
  unknown_tool: { label: "Unknown tool", tone: "danger" },
  denied: { label: "Denied", tone: "warning" },
  outcome_unknown: { label: "Execution outcome unknown", tone: "warning" },
};

function isBusyTurnRun(run: string): boolean {
  return run !== "idle" && run !== "failed" && run !== "starting";
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
