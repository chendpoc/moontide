/** Checkpoint metadata. See docs/spec/context-composer.md §6.4. */

export interface Checkpoint {
  id: string;
  sessionId: string;
  createdAtTurn: number;
  lastItemId: string;
  instructionEpoch: number;
  activeCompactionSaveId?: string;
  composerPolicyVersion?: string;
  label?: string;
}
