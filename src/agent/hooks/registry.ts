import type { HookErrorPolicy, HookPhase } from "./phases.js";
import { PHASE_DEFS } from "./phases.js";
import type { HookHandler, HookRegistration } from "./types.js";

let registrations: HookRegistration[] = [];

function resolveErrorPolicy(
  phase: HookPhase,
  override: HookErrorPolicy | undefined,
): HookErrorPolicy {
  return override ?? PHASE_DEFS[phase].defaultErrorPolicy;
}

export interface SidecarHookRegistry {
  on<P extends HookPhase>(
    phase: P,
    name: string,
    handler: HookHandler<P>,
    options?: { order?: number; errorPolicy?: HookErrorPolicy },
  ): () => void;
  clear(): void;
}

export function sidecarHooks(): SidecarHookRegistry {
  return {
    on(phase, name, handler, options) {
      const entry: HookRegistration = {
        phase,
        name,
        handler: handler as HookHandler<HookPhase>,
        order: options?.order ?? 0,
        errorPolicy: options?.errorPolicy,
      };
      registrations = [...registrations, entry];
      return () => {
        registrations = registrations.filter((item) => item !== entry);
      };
    },
    clear() {
      registrations = [];
    },
  };
}

export function getHookRegistrations(phase: HookPhase): readonly HookRegistration[] {
  return registrations
    .filter((entry) => entry.phase === phase)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function resolveRegistrationErrorPolicy(entry: HookRegistration): HookErrorPolicy {
  return resolveErrorPolicy(entry.phase, entry.errorPolicy);
}
