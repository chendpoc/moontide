import type { Checkpoint } from "../session/stores/checkpoint-types.js";
import type { SessionStores } from "../session/stores/index.js";
import type { Session } from "../session/session.js";
import { newEventId } from "../utils/id.js";

export interface CheckpointSessionState {
  getActiveCompactionSaveId: () => string | undefined;
  setActiveCompactionSaveId: (id: string | undefined) => void;
  setResumeCheckpointId: (id: string | undefined) => void;
}

export class CheckpointService {
  constructor(
    private readonly session: Session,
    private readonly stores: SessionStores,
    private readonly state: CheckpointSessionState,
  ) {}

  async create(turn: number, label?: string): Promise<Checkpoint> {
    const lastMessage = this.session.getMessages().at(-1);
    if (!lastMessage) {
      throw new Error("Cannot create checkpoint: session has no messages");
    }

    const checkpoint: Checkpoint = {
      id: newEventId(),
      sessionId: this.session.sessionId,
      createdAtTurn: turn,
      lastItemId: lastMessage.id,
      instructionEpoch: 1,
      activeCompactionSaveId: this.state.getActiveCompactionSaveId(),
      label,
    };

    await this.stores.checkpoints.save(checkpoint);
    await this.session.appendCheckpointItem(turn, checkpoint.id);
    return checkpoint;
  }

  async resume(checkpointId: string): Promise<boolean> {
    const checkpoint = await this.stores.checkpoints.get(this.session.sessionId, checkpointId);
    if (!checkpoint) {
      return false;
    }

    this.session.truncateMessages(checkpoint.lastItemId);
    this.state.setResumeCheckpointId(checkpointId);
    this.state.setActiveCompactionSaveId(checkpoint.activeCompactionSaveId);
    return true;
  }
}
