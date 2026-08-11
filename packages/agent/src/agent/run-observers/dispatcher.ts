import { emit } from "../../log/index.js";
import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { AppError } from "@moontide/shared/errors/app-error.js";
import { toMessage, toStack } from "@moontide/shared/errors/normalize.js";
import type { RunObserverRegistry } from "../runtime/observer-registry.js";
import type { ObserverPhase } from "./phases.js";
import { PHASE_DEFS } from "./phases.js";
import {
  emitObserverError,
  logObserverFailure,
  toObserverFailureRecord,
} from "./failures.js";
import { parseStepObserveResult } from "./parse-events.js";
import type {
  ObserverContextMap,
  ObserverDispatchResultMap,
  StepObserveResult,
  ToolUseContext,
} from "./types.js";
import type { LLMCallRecord, ToolUseRecord } from "../pipeline/types.js";

export class RunObserverError extends AppError {
  readonly handlerName: string;
  readonly phase: ObserverPhase;

  constructor(handlerName: string, phase: ObserverPhase, cause: unknown) {
    super(
      ErrorCode.INTERNAL,
      `Hook handler "${handlerName}" failed on ${phase}: ${toMessage(cause)}`,
      { cause },
    );
    this.name = "RunObserverError";
    this.handlerName = handlerName;
    this.phase = phase;
    const stack = toStack(cause);
    if (stack) {
      this.stack = stack;
    }
  }
}

async function invokeHandler(
  phase: ObserverPhase,
  name: string,
  errorPolicy: "fail-open" | "fail-closed",
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (errorPolicy === "fail-closed") {
      throw new RunObserverError(name, phase, err);
    }
    logObserverFailure(toObserverFailureRecord(phase, name, err));
  }
}

export class RunObserverDispatcher {
  constructor(private readonly registry: RunObserverRegistry) {}

  async dispatch<P extends ObserverPhase>(
    phase: P,
    ctx: ObserverContextMap[P],
  ): Promise<ObserverDispatchResultMap[P]> {
    const mode = PHASE_DEFS[phase].mode;
    if (mode === "observe") {
      return (await this.dispatchObserve(phase, ctx)) as ObserverDispatchResultMap[P];
    }
    if (mode === "decide") {
      return (await this.dispatchDecide(phase, ctx)) as ObserverDispatchResultMap[P];
    }
    await this.dispatchTransform(phase, ctx);
    return undefined as ObserverDispatchResultMap[P];
  }

  private async dispatchObserve<P extends ObserverPhase>(
    phase: P,
    ctx: ObserverContextMap[P],
  ): Promise<ObserverDispatchResultMap[P]> {
    const modelAppends: string[] = [];
    const record =
      phase === "llmCall" || phase === "toolUse"
        ? (ctx as LLMCallRecord | ToolUseRecord)
        : undefined;

    for (const entry of this.registry.getRegistrations(phase)) {
      await invokeHandler(
        phase,
        entry.name,
        this.registry.resolveRegistrationErrorPolicy(entry),
        async () => {
          try {
            const result = await entry.handler(ctx as ObserverContextMap[ObserverPhase]);
            const parsed = parseStepObserveResult(result as StepObserveResult);
            for (const draft of parsed.drafts) {
              emit({
                ...draft,
                turn: draft.turn ?? record?.turn,
              });
            }
            if (phase === "toolUse" && parsed.modelAppend) {
              modelAppends.push(parsed.modelAppend);
            }
          } catch (err) {
            if (this.registry.resolveRegistrationErrorPolicy(entry) === "fail-closed") {
              throw err;
            }
            emitObserverError(phase, entry.name, record, err);
          }
        },
      );
    }

    if (phase === "toolUse") {
      return { modelAppends } as ObserverDispatchResultMap[P];
    }
    return undefined as ObserverDispatchResultMap[P];
  }

  private async dispatchDecide<P extends ObserverPhase>(
    phase: P,
    ctx: ObserverContextMap[P],
  ): Promise<ObserverDispatchResultMap[P]> {
    for (const entry of this.registry.getRegistrations(phase)) {
      try {
        const result = await entry.handler(ctx as ObserverContextMap[ObserverPhase]);
        if (result && typeof result === "object" && "block" in result && result.block) {
          return result as ObserverDispatchResultMap[P];
        }
      } catch (err) {
        if (this.registry.resolveRegistrationErrorPolicy(entry) === "fail-closed") {
          throw new RunObserverError(entry.name, phase, err);
        }
        const record = phase === "beforeToolUse" ? (ctx as ToolUseContext) : (ctx as ToolUseRecord);
        emitObserverError(phase, entry.name, record, err);
      }
    }
    return undefined as ObserverDispatchResultMap[P];
  }

  private async dispatchTransform<P extends ObserverPhase>(
    phase: P,
    ctx: ObserverContextMap[P],
  ): Promise<void> {
    for (const entry of this.registry.getRegistrations(phase)) {
      await invokeHandler(
        phase,
        entry.name,
        this.registry.resolveRegistrationErrorPolicy(entry),
        async () => {
          await entry.handler(ctx as ObserverContextMap[ObserverPhase]);
        },
      );
    }
  }
}
