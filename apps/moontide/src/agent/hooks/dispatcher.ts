import { emit } from "../../log/index.js";
import { ErrorCode } from "@moontide/shared/errors/codes.js";
import { AppError } from "@moontide/shared/errors/app-error.js";
import { toMessage, toStack } from "@moontide/shared/errors/normalize.js";
import type { HookRegistry } from "../runtime/hook-registry.js";
import type { HookPhase } from "./phases.js";
import { PHASE_DEFS } from "./phases.js";
import {
  emitHookError,
  logHookFailure,
  toHookFailureRecord,
} from "./failures.js";
import { parseStepObserveResult } from "./parse-events.js";
import type {
  HookContextMap,
  HookDispatchResultMap,
  StepObserveResult,
  ToolUseContext,
} from "./types.js";
import type { LLMCallRecord, ToolUseRecord } from "../pipeline/types.js";

export class HookObserverError extends AppError {
  readonly handlerName: string;
  readonly phase: HookPhase;

  constructor(handlerName: string, phase: HookPhase, cause: unknown) {
    super(
      ErrorCode.INTERNAL,
      `Hook handler "${handlerName}" failed on ${phase}: ${toMessage(cause)}`,
      { cause },
    );
    this.name = "HookObserverError";
    this.handlerName = handlerName;
    this.phase = phase;
    const stack = toStack(cause);
    if (stack) {
      this.stack = stack;
    }
  }
}

async function invokeHandler(
  phase: HookPhase,
  name: string,
  errorPolicy: "fail-open" | "fail-closed",
  fn: () => Promise<void>,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (errorPolicy === "fail-closed") {
      throw new HookObserverError(name, phase, err);
    }
    logHookFailure(toHookFailureRecord(phase, name, err));
  }
}

export class HookDispatcher {
  constructor(private readonly registry: HookRegistry) {}

  async dispatch<P extends HookPhase>(
    phase: P,
    ctx: HookContextMap[P],
  ): Promise<HookDispatchResultMap[P]> {
    const mode = PHASE_DEFS[phase].mode;
    if (mode === "observe") {
      return (await this.dispatchObserve(phase, ctx)) as HookDispatchResultMap[P];
    }
    if (mode === "decide") {
      return (await this.dispatchDecide(phase, ctx)) as HookDispatchResultMap[P];
    }
    await this.dispatchTransform(phase, ctx);
    return undefined as HookDispatchResultMap[P];
  }

  private async dispatchObserve<P extends HookPhase>(
    phase: P,
    ctx: HookContextMap[P],
  ): Promise<HookDispatchResultMap[P]> {
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
            const result = await entry.handler(ctx as HookContextMap[HookPhase]);
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
            emitHookError(phase, entry.name, record, err);
          }
        },
      );
    }

    if (phase === "toolUse") {
      return { modelAppends } as HookDispatchResultMap[P];
    }
    return undefined as HookDispatchResultMap[P];
  }

  private async dispatchDecide<P extends HookPhase>(
    phase: P,
    ctx: HookContextMap[P],
  ): Promise<HookDispatchResultMap[P]> {
    for (const entry of this.registry.getRegistrations(phase)) {
      try {
        const result = await entry.handler(ctx as HookContextMap[HookPhase]);
        if (result && typeof result === "object" && "block" in result && result.block) {
          return result as HookDispatchResultMap[P];
        }
      } catch (err) {
        if (this.registry.resolveRegistrationErrorPolicy(entry) === "fail-closed") {
          throw new HookObserverError(entry.name, phase, err);
        }
        const record = phase === "beforeToolUse" ? (ctx as ToolUseContext) : (ctx as ToolUseRecord);
        emitHookError(phase, entry.name, record, err);
      }
    }
    return undefined as HookDispatchResultMap[P];
  }

  private async dispatchTransform<P extends HookPhase>(
    phase: P,
    ctx: HookContextMap[P],
  ): Promise<void> {
    for (const entry of this.registry.getRegistrations(phase)) {
      await invokeHandler(
        phase,
        entry.name,
        this.registry.resolveRegistrationErrorPolicy(entry),
        async () => {
          await entry.handler(ctx as HookContextMap[HookPhase]);
        },
      );
    }
  }
}
