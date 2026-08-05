import { formatErrorTerminal } from "../log/format/format-error.js";
import { writeStderrBlock } from "../terminal/write.js";
import { emitDebugRecord } from "../context-inspect/debug-emit.js";
import {
  isDebugFileEnabled,
  isDebugTerminalEnabled,
} from "../context-inspect/debug-mode.js";
import { emitDraft } from "../log/event-hub.js";
import { getRunId } from "../log/run.js";
import type { AgentChannel, AgentPhase } from "../log/types.js";
import { errorRecordToEventPayload, type ErrorRecord } from "./record.js";

export interface ReportErrorRoute {
  channel: AgentChannel;
  phase: AgentPhase;
  turn?: number;
  hook?: string;
  toolName?: string;
  toolUseId?: string;
}

export interface ReportErrorOptions {
  stderr?: boolean;
  event?: boolean;
  debug?: boolean;
  route?: ReportErrorRoute;
}

export function reportError(record: ErrorRecord, options: ReportErrorOptions = {}): void {
  const stderr = options.stderr ?? true;
  const event = options.event ?? Boolean(options.route);
  const debug = options.debug ?? true;

  const enriched: ErrorRecord = {
    ...record,
    runId: record.runId ?? getRunId(),
  };

  if (stderr) {
    writeStderrBlock(formatErrorTerminal(enriched));
  }

  if (event && options.route) {
    const { channel, phase, turn, hook, toolName, toolUseId } = options.route;
    emitDraft({
      turn: turn ?? enriched.turn ?? 0,
      phase,
      channel,
      kind: "plugin_error",
      payload: {
        ...errorRecordToEventPayload(enriched),
        hook: hook ?? enriched.hook,
        toolName: toolName ?? enriched.toolName,
        toolUseId: toolUseId ?? enriched.toolUseId,
      },
      preview: `${hook ?? enriched.hook ?? enriched.source}/${phase}`,
    });
  }

  if (debug && (isDebugTerminalEnabled() || isDebugFileEnabled())) {
    emitDebugRecord({
      kind: "error",
      turn: enriched.turn ?? 0,
      ...errorRecordToEventPayload(enriched),
    });
  }
}
