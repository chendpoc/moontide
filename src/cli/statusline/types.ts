export type SessionPhase = "idle" | "running";

export type StatusLineSegmentId =
  | "product"
  | "context"
  | "turn"
  | "model"
  | "workdir"
  | "run"
  | "api_in"
  | "api_out";

export interface StatusSnapshot {
  phase: SessionPhase;
  model: string;
  workdir: string;
  runId: string;
  turn: number | null;
  contextPct: number | null;
  contextUsed: number | null;
  contextLimit: number | null;
  contextDelta: number | null;
  contextHasBaseline: boolean;
  lastApiIn: number | null;
  lastApiOut: number | null;
}

/** JSON payload for status line command hook (Cursor / Claude Code compatible shape). */
export interface StatusLinePayload {
  session_id: string;
  cwd: string;
  model: {
    id: string;
    display_name: string;
  };
  context_window: {
    used_tokens: number | null;
    context_window_size: number | null;
    used_percentage: number | null;
    delta_tokens: number | null;
    has_baseline: boolean;
  };
  usage: {
    input_tokens: number | null;
    output_tokens: number | null;
  };
  turn: number | null;
  phase: SessionPhase;
  run_id: string;
}

export interface StatusLineConfig {
  segments: StatusLineSegmentId[];
  command?: string;
  commandTimeoutMs: number;
}

export const DEFAULT_STATUS_LINE_SEGMENTS: StatusLineSegmentId[] = [
  "product",
  "context",
  "turn",
  "model",
  "workdir",
];

export const ALL_STATUS_LINE_SEGMENT_IDS: StatusLineSegmentId[] = [
  "product",
  "context",
  "turn",
  "model",
  "workdir",
  "run",
  "api_in",
  "api_out",
];
