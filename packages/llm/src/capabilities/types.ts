import type { AdapterFamily } from "../presets/presets.js";

export type CapabilityStatus = "supported" | "ignored" | "rejected" | "emulated";

export interface AdapterCapabilityDeclaration {
  capability: string;
  providerPresetId: string;
  adapterFamily: AdapterFamily;
  status: CapabilityStatus;
  notes?: string;
  contractTest?: string;
}

export interface CapabilityLookup {
  capability: string;
  providerPresetId: string;
  adapterFamily: AdapterFamily;
}
