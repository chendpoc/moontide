import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type {
  EvalCaseDefinition,
  EvalRunOutput,
  MoonTideEvalHarnessConfig,
  PairGradeItem,
} from "./types.js";

export interface AgentJobPayload {
  baseline: MoonTideEvalHarnessConfig;
  candidate: MoonTideEvalHarnessConfig;
  caseDef: EvalCaseDefinition;
  repetition: number;
  artifactDir?: string;
  recordHttpFixtures?: boolean;
}

export interface AgentJobResult {
  baseline: EvalRunOutput;
  candidate: EvalRunOutput;
}

const DEFAULT_JOB_TIMEOUT_MS = 900_000;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const workerScript = path.join(packageRoot, "scripts/run-agent-job.ts");

function _failedOutput(
  harness: MoonTideEvalHarnessConfig,
  caseDef: EvalCaseDefinition,
  repetition: number,
  message: string,
): EvalRunOutput {
  return {
    harnessName: harness.name,
    caseId: caseDef.id,
    repetition,
    sessionId: "",
    reply: "",
    turn: 0,
    items: [],
    durationMs: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
    error: message,
  };
}

/** Run baseline+candidate for one case in an isolated subprocess. */
export async function spawnAgentJob(
  payload: AgentJobPayload,
  timeoutMs = DEFAULT_JOB_TIMEOUT_MS,
): Promise<PairGradeItem> {
  return new Promise((resolve) => {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "--tsconfig", "tsconfig.dev.json", workerScript],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: PairGradeItem): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        caseId: payload.caseDef.id,
        caseDef: payload.caseDef,
        baseline: _failedOutput(
          payload.baseline,
          payload.caseDef,
          payload.repetition,
          `agent job timed out after ${timeoutMs}ms`,
        ),
        candidate: _failedOutput(
          payload.candidate,
          payload.caseDef,
          payload.repetition,
          `agent job timed out after ${timeoutMs}ms`,
        ),
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      finish({
        caseId: payload.caseDef.id,
        caseDef: payload.caseDef,
        baseline: _failedOutput(payload.baseline, payload.caseDef, payload.repetition, err.message),
        candidate: _failedOutput(payload.candidate, payload.caseDef, payload.repetition, err.message),
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const message = stderr.trim() || `agent job exited with code ${code ?? "unknown"}`;
        finish({
          caseId: payload.caseDef.id,
          caseDef: payload.caseDef,
          baseline: _failedOutput(payload.baseline, payload.caseDef, payload.repetition, message),
          candidate: _failedOutput(payload.candidate, payload.caseDef, payload.repetition, message),
        });
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as AgentJobResult;
        finish({
          caseId: payload.caseDef.id,
          caseDef: payload.caseDef,
          baseline: parsed.baseline,
          candidate: parsed.candidate,
        });
      } catch {
        finish({
          caseId: payload.caseDef.id,
          caseDef: payload.caseDef,
          baseline: _failedOutput(
            payload.baseline,
            payload.caseDef,
            payload.repetition,
            "failed to parse agent job stdout",
          ),
          candidate: _failedOutput(
            payload.candidate,
            payload.caseDef,
            payload.repetition,
            stderr.trim() || "failed to parse agent job stdout",
          ),
        });
      }
    });

    child.stdin.write(`${JSON.stringify(payload)}\n`);
    child.stdin.end();
  });
}
