import type { ObserverErrorPolicy, ObserverPhase } from "../run-observers/phases.js";
import { PHASE_DEFS } from "../run-observers/phases.js";
import type { ObserverHandler, ObserverRegistration } from "../run-observers/types.js";

function resolveErrorPolicy(
  phase: ObserverPhase,
  override: ObserverErrorPolicy | undefined,
): ObserverErrorPolicy {
  return override ?? PHASE_DEFS[phase].defaultErrorPolicy;
}

export interface SidecarRunObserverRegistry {
  on<P extends ObserverPhase>(
    phase: P,
    name: string,
    handler: ObserverHandler<P>,
    options?: { order?: number; errorPolicy?: ObserverErrorPolicy },
  ): () => void;
  clear(): void;
}

export class RunObserverRegistry {
  private registrations: ObserverRegistration[] = [];

  sidecar(): SidecarRunObserverRegistry {
    return {
      on: (phase, name, handler, options) => this.register(phase, name, handler, options),
      clear: () => this.clear(),
    };
  }

  register<P extends ObserverPhase>(
    phase: P,
    name: string,
    handler: ObserverHandler<P>,
    options?: { order?: number; errorPolicy?: ObserverErrorPolicy },
  ): () => void {
    const entry: ObserverRegistration = {
      phase,
      name,
      handler: handler as ObserverHandler<ObserverPhase>,
      order: options?.order ?? 0,
      errorPolicy: options?.errorPolicy,
    };
    this.registrations = [...this.registrations, entry];
    return () => {
      this.registrations = this.registrations.filter((item) => item !== entry);
    };
  }

  getRegistrations(phase: ObserverPhase): readonly ObserverRegistration[] {
    return this.registrations
      .filter((entry) => entry.phase === phase)
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  resolveRegistrationErrorPolicy(entry: ObserverRegistration): ObserverErrorPolicy {
    return resolveErrorPolicy(entry.phase, entry.errorPolicy);
  }

  clear(): void {
    this.registrations = [];
  }
}
