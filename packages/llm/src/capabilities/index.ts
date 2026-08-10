import { DEEPSEEK_CHAT_CAPABILITIES } from "./deepseek-chat.js";
import { DEEPSEEK_RESPONSES_CAPABILITIES } from "./deepseek-responses.js";
import type {
  AdapterCapabilityDeclaration,
  CapabilityLookup,
  CapabilityStatus,
} from "./types.js";

export type { AdapterCapabilityDeclaration, CapabilityLookup, CapabilityStatus } from "./types.js";

const ALL_DECLARATIONS: AdapterCapabilityDeclaration[] = [
  ...DEEPSEEK_CHAT_CAPABILITIES,
  ...DEEPSEEK_RESPONSES_CAPABILITIES,
];

export function listAdapterCapabilityDeclarations(): readonly AdapterCapabilityDeclaration[] {
  return ALL_DECLARATIONS;
}

/** Lookup declared capability status; unknown capabilities default to rejected. */
export function lookupCapabilityStatus(lookup: CapabilityLookup): CapabilityStatus {
  const match = ALL_DECLARATIONS.find(
    (row) =>
      row.capability === lookup.capability
      && row.providerPresetId === lookup.providerPresetId
      && row.adapterFamily === lookup.adapterFamily,
  );
  return match?.status ?? "rejected";
}

export function findCapabilityDeclaration(
  lookup: CapabilityLookup,
): AdapterCapabilityDeclaration | undefined {
  return ALL_DECLARATIONS.find(
    (row) =>
      row.capability === lookup.capability
      && row.providerPresetId === lookup.providerPresetId
      && row.adapterFamily === lookup.adapterFamily,
  );
}
