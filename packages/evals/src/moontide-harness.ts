import fs from "node:fs";
import path from "node:path";

import { resetEvalHarnessOverrides, setEvalProtocolRemindersEnabled } from "../../../apps/moontide/src/agent/harness/eval-overrides.js";
import { AgentSession } from "../../../apps/moontide/src/agent/agent-session.js";
import { setupAgentEventPipeline } from "../../../apps/moontide/src/app/bootstrap.js";
import { applyDeepPromptGate, getActiveWorkMemId, resetDeepModeOnNewSession } from "../../../apps/moontide/src/agent/deep-mode.js";
import { createDefaultLoopContext } from "../../../apps/moontide/src/agent/deps.js";
import { setWorkdir } from "../../../apps/moontide/src/config.js";
import { resetEventPlatform } from "../../../apps/moontide/src/log/setup.js";
import { resetRuntimeStatus } from "../../../apps/moontide/src/agent/context-status.js";
import { setDebugOverride, resetDebugOverride } from "../../../apps/moontide/src/context-inspect/debug-mode.js";
import type { UserInteraction } from "@moontide/tools";
import { joinPath } from "@moontide/shared/utils/path.js";
import { createTmpDir, removeTmpDir } from "@moontide/shared/utils/tmp.js";
import { readWorkMemEvents } from "@moontide/tools";
import { disableTestCollector, enableTestCollector, getCollectedEvents, getRunId } from "@moontide/log";
import type { AgentEvent } from "@moontide/log";

import type { AgentJobPayload, AgentJobResult } from "./agent-worker.js";
import { clearEvalHttpFixtures, installEvalHttpFixtures } from "./http-fixtures.js";
import { filePathsFromChecks } from "./graders/objective-checks.js";
import { runProtocolChecks } from "./graders/protocol-checks.js";
import { clearEvalRuntime, installEvalHttpReplay, installEvalRuntime } from "./eval-runtime.js";
import { copyRunArtifacts } from "./persist-run-artifacts.js";
import { isRateLimitError, withRetry } from "./retry.js";
import type { EvalCaseDefinition, EvalRunOutput, MoonTideEvalHarnessConfig } from "./types.js";

const allowAllInteraction: UserInteraction = {
  approveTool: async () => true,
  askQuestion: async () => {
    throw new Error("User question prompt is not configured");
  },
};

export interface RunEvalCaseOptions {
  artifactDir?: string;
  recordHttpFixtures?: boolean;
}

function _writeSetupFiles(workdir: string, files: Record<string, string> | undefined): void {
  if (!files) {
    return;
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = joinPath(workdir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
}

function _countToolCalls(items: EvalRunOutput["items"]): number {
  return items.filter((item) => item.kind === "tool_invocation").length;
}

function _snapshotFiles(workdir: string, relativePaths: string[]): Record<string, string> {
  const files: Record<string, string> = {};
  for (const relativePath of relativePaths) {
    const fullPath = joinPath(workdir, relativePath);
    if (fs.existsSync(fullPath)) {
      files[relativePath] = fs.readFileSync(fullPath, "utf8");
    }
  }
  return files;
}

function _usageFromEvents(events: AgentEvent[]): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  for (const event of events) {
    if (event.channel !== "context" || event.kind !== "context_metrics") {
      continue;
    }
    const payload = event.payload as { report?: { usage?: { inputTokens?: number; outputTokens?: number } } };
    const usage = payload.report?.usage;
    if (usage?.inputTokens !== undefined) {
      inputTokens += usage.inputTokens;
    }
    if (usage?.outputTokens !== undefined) {
      outputTokens += usage.outputTokens;
    }
  }
  return { inputTokens, outputTokens };
}

function _setupHttpFixtures(
  caseDef: EvalCaseDefinition,
  options: RunEvalCaseOptions,
): void {
  if (!caseDef.httpFixturesPath) {
    return;
  }
  installEvalHttpFixtures(caseDef.httpFixturesPath, { record: options.recordHttpFixtures });
  installEvalHttpReplay();
}

/** Run one eval case against MoonTide AgentSession harness (real LLM). */
export async function runEvalCase(
  harness: MoonTideEvalHarnessConfig,
  caseDef: EvalCaseDefinition,
  repetition: number,
  options: RunEvalCaseOptions = {},
): Promise<EvalRunOutput> {
  const workdir = createTmpDir(`moontide-eval-${caseDef.id}-`);

  setEvalProtocolRemindersEnabled(!harness.disableProtocolReminders);
  resetDeepModeOnNewSession();
  resetRuntimeStatus();
  setWorkdir(workdir);
  _writeSetupFiles(workdir, caseDef.setup?.files);
  _setupHttpFixtures(caseDef, options);

  setDebugOverride("file");
  enableTestCollector();

  const runtime = installEvalRuntime(workdir);
  setupAgentEventPipeline(runtime);

  const started = Date.now();
  let reply = "";
  let turn = 0;
  let sessionId = "";
  let runId: string | undefined;
  let items: EvalRunOutput["items"] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let error: string | undefined;
  let infraError = false;
  let workMemId: string | undefined;
  let workMemEvents: EvalRunOutput["workMemEvents"];
  let files: Record<string, string> | undefined;

  try {
    let agentSession = AgentSession.create(workdir);
    sessionId = agentSession.session.sessionId;

    for (const step of caseDef.steps) {
      if (step.type === "reload") {
        resetDeepModeOnNewSession();
        agentSession = AgentSession.create(workdir);
        sessionId = agentSession.session.sessionId;
        agentSession.runtime.tools.refresh();
        continue;
      }

      const gate = applyDeepPromptGate(step.content, sessionId);
      if (gate.deepActivated) {
        agentSession.runtime.tools.refresh();
      }

      const loopCtx = {
        ...createDefaultLoopContext(agentSession.session, agentSession.runtime),
        userInteraction: allowAllInteraction,
      };

      const result = await withRetry(
        () => agentSession.run(gate.prompt, loopCtx),
        { isRetryable: isRateLimitError },
      );
      reply = result.reply;
      turn = result.turn;
      items = await agentSession.session.readItems();
      sessionId = agentSession.session.sessionId;
      runId = getRunId();
    }

    workMemId = getActiveWorkMemId(sessionId);
    if (workMemId) {
      workMemEvents = readWorkMemEvents(workdir, sessionId, workMemId);
    }

    const usage = _usageFromEvents(getCollectedEvents());
    inputTokens = usage.inputTokens;
    outputTokens = usage.outputTokens;

    const filePaths = filePathsFromChecks(caseDef.expectedChecks ?? []);
    if (filePaths.length > 0) {
      files = _snapshotFiles(workdir, filePaths);
    }

    if (options.artifactDir) {
      copyRunArtifacts({
        workdir,
        sessionId,
        runId,
        artifactDir: options.artifactDir,
        label: `${caseDef.id}-r${repetition}-${harness.name}`,
      });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    infraError = isRateLimitError(err);
  } finally {
    disableTestCollector();
    resetDebugOverride();
    resetEventPlatform();
    clearEvalHttpFixtures();
    clearEvalRuntime();
    removeTmpDir(workdir);
    resetEvalHarnessOverrides();
  }

  return {
    harnessName: harness.name,
    caseId: caseDef.id,
    repetition,
    sessionId,
    runId,
    reply,
    turn,
    items,
    workMemId,
    workMemEvents,
    files,
    durationMs: Date.now() - started,
    inputTokens,
    outputTokens,
    toolCallCount: _countToolCalls(items),
    error,
    infraError,
  };
}

/** Run baseline then candidate for one case (subprocess worker entry). */
export async function runEvalCasePair(payload: AgentJobPayload): Promise<AgentJobResult> {
  const options: RunEvalCaseOptions = {
    artifactDir: payload.artifactDir,
    recordHttpFixtures: payload.recordHttpFixtures,
  };
  const baseline = await runEvalCase(payload.baseline, payload.caseDef, payload.repetition, options);
  const candidate = await runEvalCase(payload.candidate, payload.caseDef, payload.repetition, options);
  return { baseline, candidate };
}

export function createMoonTideEvalHarness(
  config: MoonTideEvalHarnessConfig,
): MoonTideEvalHarnessConfig {
  return config;
}

export { runProtocolChecks };
