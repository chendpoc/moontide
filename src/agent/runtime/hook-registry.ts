import type { HookErrorPolicy, HookPhase } from "../hooks/phases.js";
import { PHASE_DEFS } from "../hooks/phases.js";
import type { HookHandler, HookRegistration } from "../hooks/types.js";

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

export class HookRegistry {
  private registrations: HookRegistration[] = [];

  sidecar(): SidecarHookRegistry {
    return {
      on: (phase, name, handler, options) => this.register(phase, name, handler, options),
      clear: () => this.clear(),
    };
  }

  register<P extends HookPhase>(
    phase: P,
    name: string,
    handler: HookHandler<P>,
    options?: { order?: number; errorPolicy?: HookErrorPolicy },
  ): () => void {
    const entry: HookRegistration = {
      phase,
      name,
      handler: handler as HookHandler<HookPhase>,
      order: options?.order ?? 0,
      errorPolicy: options?.errorPolicy,
    };
    this.registrations = [...this.registrations, entry];
    return () => {
      this.registrations = this.registrations.filter((item) => item !== entry);
    };
  }

  getRegistrations(phase: HookPhase): readonly HookRegistration[] {
    return this.registrations
      .filter((entry) => entry.phase === phase)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  resolveRegistrationErrorPolicy(entry: HookRegistration): HookErrorPolicy {
    return resolveErrorPolicy(entry.phase, entry.errorPolicy);
  }

  clear(): void {
    this.registrations = [];
  }
}
