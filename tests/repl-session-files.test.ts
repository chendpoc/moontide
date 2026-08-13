import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setWorkdir } from "../packages/agent/src/config.js";
import { debugLogPath } from "../packages/agent/src/context-inspect/debug-file.js";
import {
  resetDebugOverride,
  setDebugOverride,
} from "../packages/agent/src/context-inspect/debug-mode.js";
import {
  getOrStartReplSession,
  getReplAgentSession,
  resetReplSession,
  startReplSession,
} from "../packages/agent-cli/src/cli/repl/session.js";
import { resetReplConversation } from "../packages/agent-cli/src/cli/commands/reset.js";
import { sessionLogPath } from "@moontide/session";
import { clearTestRuntime, installTestRuntime } from "./helpers/test-runtime.js";
import { createTmpWorkdir, removeTmpWorkdir } from "./helpers/tmp-workdir.js";

describe("repl session files", () => {
  let tmpDir = "";
  let originalWorkdir = "";

  beforeEach(() => {
    originalWorkdir = tmpDir;
    tmpDir = createTmpWorkdir("moontide-repl-session-");
    setWorkdir(tmpDir);
    installTestRuntime(tmpDir);
    resetDebugOverride();
    delete process.env.MOONTIDE_ENV;
    delete process.env.MOONTIDE_DEBUG;
  });

  afterEach(() => {
    resetReplSession();
    resetDebugOverride();
    clearTestRuntime();
    setWorkdir(originalWorkdir);
    removeTmpWorkdir(tmpDir);
  });

  it("startReplSession materializes empty session log", () => {
    const agentSession = startReplSession();
    const path = sessionLogPath(tmpDir, agentSession.session.sessionId);
    expect(fs.existsSync(path)).toBe(true);
    expect(fs.statSync(path).size).toBe(0);
  });

  it("startReplSession materializes debug log when debug file tier is on", () => {
    setDebugOverride("file");
    const agentSession = startReplSession();
    const path = debugLogPath(tmpDir, agentSession.session.sessionId);
    expect(fs.existsSync(path)).toBe(true);
    expect(fs.statSync(path).size).toBe(0);
  });

  it("getOrStartReplSession reuses session and keeps one session log", () => {
    const first = getOrStartReplSession();
    const second = getOrStartReplSession();
    expect(second.session.sessionId).toBe(first.session.sessionId);
    expect(getReplAgentSession()?.session.sessionId).toBe(first.session.sessionId);
  });

  it("resetReplConversation starts a new session with fresh session log", () => {
    const first = startReplSession();
    const firstSessionId = first.session.sessionId;

    resetReplConversation();

    const second = getReplAgentSession();
    expect(second).not.toBeNull();
    expect(second!.session.sessionId).not.toBe(firstSessionId);
    expect(fs.existsSync(sessionLogPath(tmpDir, firstSessionId))).toBe(true);
    expect(fs.existsSync(sessionLogPath(tmpDir, second!.session.sessionId))).toBe(true);
  });

  it("resetReplConversation materializes debug log when dev default debug is on", () => {
    process.env.MOONTIDE_ENV = "dev";
    startReplSession();
    resetReplConversation();
    const second = getReplAgentSession()!;
    expect(fs.existsSync(debugLogPath(tmpDir, second.session.sessionId))).toBe(true);
  });
});
