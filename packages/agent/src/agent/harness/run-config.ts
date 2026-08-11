import type { RunConfig } from "@moontide/run-protocol";
import { isAssistantMessage } from "@moontide/run-protocol";
import type { ComposedContext } from "@moontide/context-composer";
import type { SessionStores } from "@moontide/session/stores";
import { getToolDefinitions } from "../../tools/index.js";
import type { Session } from "@moontide/session";
import type { LoopContext } from "../deps.js";
import { composeForSession, type ComposeForSessionInput } from "../compose-for-turn.js";
import { publishComposeResult, patchLastManifestDeepTask } from "../context-status.js";
import {
  getActiveWorkMemId,
  isDeepModeEnabled,
} from "../deep-mode.js";
import {
  ORIENT_PROTOCOL_REMINDER_TEXT,
  SYNTHESIZE_PROTOCOL_REMINDER_TEXT,
  shouldSendOrientProtocolReminder,
} from "../deep-task-protocol.js";
import { getWorkMemAgentPorts } from "../ports/work-mem.js";
import { freezeToolUseContext, buildModelToolResult } from "../pipeline/tool-result.js";
import type { ToolUseOutcome, ToolUseRecord } from "../pipeline/types.js";
import { isEvalProtocolRemindersEnabled } from "./eval-overrides.js";
import { assistantMessageToContentBlocks } from "./message-map.js";
import { llmProtocolMessagesToPort } from "./message-map.js";
import { setComposeRequest, type ComposeState } from "./compose-state.js";
import type { AgentRunComposeOptions } from "../agent-run.js";

export interface MoonTideRunConfigOptions {
  session: Session;
  stores: SessionStores;
  loopCtx: LoopContext;
  composeOptions: AgentRunComposeOptions;
  composeState: ComposeState;
  deepModeState?: DeepModeRunState;
}

export interface DeepModeRunState {
  orientProtocolReminderSent: boolean;
  synthesizeProtocolReminderSent: boolean;
}

export function createDeepModeRunState(): DeepModeRunState {
  return {
    orientProtocolReminderSent: false,
    synthesizeProtocolReminderSent: false,
  };
}

export function createMoonTideRunConfig(options: MoonTideRunConfigOptions): RunConfig {
  const {
    session,
    stores,
    loopCtx,
    composeOptions,
    composeState,
    deepModeState = createDeepModeRunState(),
  } = options;

  let composeTurn = 0;

  return {
    compileTurnContext: async ({ turn }) => {
      composeTurn = turn;
      const composed = await _composeTurn({
        session,
        stores,
        loopCtx,
        composeOptions,
        turn: composeTurn,
      });
      setComposeRequest(composeState, composeTurn, composed.request);
      return {
        system: composed.request.system,
        tools: composed.request.tools,
        messages: llmProtocolMessagesToPort(composed.request.messages),
        attachment: { protocolMessages: composed.request.messages },
      };
    },

    beforeToolCall: async (params) => {
      const blocked = await loopCtx.runtime.observers.dispatch(
        "beforeToolUse",
        freezeToolUseContext({
          turn: composeState.turn,
          toolName: params.toolName,
          toolInput: params.args as Record<string, unknown>,
          toolUseId: params.toolCallId,
        }),
      );
      if (blocked?.block) {
        return { block: true, reason: blocked.reason };
      }
      return undefined;
    },

    afterToolCall: async (params) => {
      const outcome: ToolUseOutcome = params.isError
        ? { status: "failed", error: params.result.content }
        : { status: "succeeded", output: params.result.content };

      const record: ToolUseRecord = {
        turn: composeState.turn,
        toolName: params.toolName,
        toolUseId: params.toolCallId,
        toolInput: params.args as Record<string, unknown>,
        outcome,
      };
      const { modelAppends } = await loopCtx.runtime.observers.dispatch("toolUse", record);
      if (modelAppends.length === 0) {
        return undefined;
      }
      return { content: buildModelToolResult(outcome, modelAppends) };
    },

    shouldStopAfterTurn: async ({ turnAssistantMessage }) => {
      const runTurn = composeState.turn;

      if (
        isAssistantMessage(turnAssistantMessage)
        && turnAssistantMessage.content.some((block) => block.type === "toolCall")
      ) {
      if (
        isDeepModeEnabled()
        && runTurn === 1
        && !deepModeState.orientProtocolReminderSent
        && isEvalProtocolRemindersEnabled()
        && shouldSendOrientProtocolReminder(assistantMessageToContentBlocks(turnAssistantMessage))
      ) {
          await session.appendProtocolReminder(runTurn, "orient", ORIENT_PROTOCOL_REMINDER_TEXT);
          deepModeState.orientProtocolReminderSent = true;
        }
        return false;
      }

      if (isDeepModeEnabled() && !_activeWorkMemHasDecision(session)) {
        if (isEvalProtocolRemindersEnabled() && !deepModeState.synthesizeProtocolReminderSent) {
          await session.appendProtocolReminder(
            runTurn,
            "synthesize",
            SYNTHESIZE_PROTOCOL_REMINDER_TEXT,
          );
          deepModeState.synthesizeProtocolReminderSent = true;
          return false;
        }
        patchLastManifestDeepTask({ synthesizeSkipped: true });
      }

      return true;
    },
  };
}

async function _composeTurn(input: {
  session: Session;
  stores: SessionStores;
  loopCtx: LoopContext;
  composeOptions: AgentRunComposeOptions;
  turn: number;
}): Promise<ComposedContext> {
  const composeInput: ComposeForSessionInput = {
    session: input.session,
    stores: input.stores,
    turn: input.turn,
    toolDefinitions: getToolDefinitions(input.loopCtx.runtime.tools),
    compactionPolicy: input.composeOptions.getCompactionPolicy(),
    resumeFromCheckpointId: input.composeOptions.resumeFromCheckpointId,
    activeCompactionSaveId: input.composeOptions.activeCompactionSaveId,
  };
  const composed = await composeForSession(composeInput);
  publishComposeResult(composed);
  await input.loopCtx.runtime.observers.dispatch("composeComplete", { composed });
  input.composeOptions.onAfterCompose?.();
  return composed;
}

function _activeWorkMemHasDecision(session: Session): boolean {
  const workMemId = getActiveWorkMemId(session.sessionId);
  if (!workMemId) {
    return false;
  }
  return getWorkMemAgentPorts().hasDecisionDraft({
    sessionId: session.sessionId,
    workMemId,
  });
}
