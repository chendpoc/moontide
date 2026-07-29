export type SessionPhase = "idle" | "running";

export interface ChannelStatus {
  enabled: boolean;
  /** Read-only summary when display is off (e.g. context %). */
  detail?: string;
}

export interface StatusSnapshot {
  phase: SessionPhase;
  model: string;
  workdir: string;
  turn: number | null;
  contextPct: number | null;
  context: ChannelStatus;
  trace: ChannelStatus;
  eventsStream: ChannelStatus;
  eventsDisplay: ChannelStatus;
}
