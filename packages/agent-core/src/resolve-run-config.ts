import type { RunConfig, RunConfigSource } from "@moontide/run-protocol";



/** Merge partial RunConfig sources and freeze for the duration of a run. */
export function resolveRunConfig(
  base: RunConfig,
  ...sources: RunConfigSource[]
): Readonly<RunConfig> {
  const merged: RunConfig = {
    compileTurnContext: base.compileTurnContext,
    convertToLlm: base.convertToLlm,
    transformContext: base.transformContext,
    beforeToolCall: base.beforeToolCall,
    afterToolCall: base.afterToolCall,
    shouldStopAfterTurn: base.shouldStopAfterTurn,
  };

  for (const source of sources) {
    if (source.compileTurnContext) {
      merged.compileTurnContext = source.compileTurnContext;
    }
    if (source.convertToLlm) {
      merged.convertToLlm = source.convertToLlm;
    }
    if (source.transformContext) {
      const prev = merged.transformContext;
      const next = source.transformContext;
      merged.transformContext = async (messages, signal) => {
        const afterPrev = prev ? await prev(messages, signal) : messages;
        return next(afterPrev, signal);
      };
    }
    if (source.beforeToolCall) {
      const prev = merged.beforeToolCall;
      const next = source.beforeToolCall;
      merged.beforeToolCall = async (params, signal) => {
        const fromPrev = prev ? await prev(params, signal) : undefined;
        if (fromPrev?.block) {
          return fromPrev;
        }
        return next(params, signal);
      };
    }
    if (source.afterToolCall) {
      const prev = merged.afterToolCall;
      const next = source.afterToolCall;
      merged.afterToolCall = async (params, signal) => {
        const fromPrev = prev ? await prev(params, signal) : undefined;
        const fromNext = await next(params, signal);
        return { ...fromPrev, ...fromNext };
      };
    }
    if (source.shouldStopAfterTurn) {
      merged.shouldStopAfterTurn = source.shouldStopAfterTurn;
    }
  }

  return Object.freeze(merged);
}

