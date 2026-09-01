import type {
  ContentBlock,
  DesktopRunState,
  ModelResponseSnapshot,
  ToolCall,
  ToolResult,
} from "$lib/protocol/index.js";
import type {
  AssistantDraftView,
  MessageView,
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
    return capitalize(run);
  }
  if ("thinking" in run) {
    return `Thinking · turn ${run.thinking.turn} · step ${run.thinking.step}`;
  }
  if ("running_tool" in run) {
    return `Running ${run.running_tool.name}`;
  }
  if ("waiting_approval" in run) {
    return "Waiting for approval";
  }
  if ("cancelling" in run) {
    return "Cancelling";
  }
  if ("failed" in run) {
    return "Failed";
  }
  return "Unknown";
}

export function composerMode(
  connection: ConnectionState,
  page: ChatPageMode,
  run: DesktopRunState,
  phase: CommandPhase,
): ComposerMode {
  if (connection.kind !== "ready") {
    return "disabled";
  }
  if (phase === "cancelling") {
    return "cancelling";
  }
  if (phase === "submitting") {
    return "submitting";
  }

  if (page === "blank") {
    return "editable";
  }

  const kind = runStateKind(run);
  if (kind === "idle" || kind === "failed") {
    return "editable";
  }
  if (kind === "thinking" || kind === "running_tool" || kind === "waiting_approval") {
    return "active";
  }
  if (kind === "cancelling" || kind === "stopping") {
    return "cancelling";
  }
  return "disabled";
}

export function allowsApproval(
  connection: ConnectionState,
  run: DesktopRunState,
  phase: CommandPhase,
): boolean {
  return (
    connection.kind === "ready" &&
    phase === "idle" &&
    runStateKind(run) === "waiting_approval"
  );
}

export function allowsSessionTransition(state: DesktopViewState): boolean {
  const run = runStateKind(state.render.run);
  return (
    state.connection.kind === "ready" &&
    (run === "idle" || run === "failed") &&
    Object.keys(state.render.approvals).length === 0 &&
    state.firstSend.kind === "idle" &&
    !state.render.delivery.awaitingSnapshot &&
    !state.render.delivery.resyncRequired
  );
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

export function blocksText(blocks: ContentBlock[]): string {
  return blocks
    .flatMap((block) => {
      switch (block.kind) {
        case "text":
          return [block.text];
        case "thinking":
          return [];
        case "tool_use":
          return [`tool: ${block.name}`];
        case "tool_result":
          return ["tool result"];
      }
    })
    .filter((text) => text.length > 0)
    .join("\n");
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
    return { label: "Running", tone: "neutral" };
  }
  if (typeof result.status === "string") {
    switch (result.status) {
      case "succeeded":
        return { label: "Succeeded", tone: "success" };
      case "invalid_arguments":
        return { label: "Invalid arguments", tone: "danger" };
      case "unknown_tool":
        return { label: "Unknown tool", tone: "danger" };
      case "denied":
        return { label: "Denied", tone: "warning" };
      case "outcome_unknown":
        return { label: "Execution outcome unknown", tone: "warning" };
    }
  }
  if ("failed" in result.status) {
    return {
      label: result.status.failed.retryable ? "Failed · retryable" : "Failed",
      tone: "danger",
    };
  }
  return {
    label: `Cancelled · ${result.status.cancelled.reason}`,
    tone: "warning",
  };
}

function capitalize(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toUpperCase()}${value.slice(1)}`;
}
