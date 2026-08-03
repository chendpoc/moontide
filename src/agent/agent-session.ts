import { getWorkdir } from "../config.js";
import { Session } from "../session/session.js";
import type { LoopContext } from "./deps.js";
import { AgentRun } from "./agent-run.js";
import type { RunHooks } from "./run-hooks.js";

export class AgentSession {
  readonly session: Session;

  private constructor(session: Session) {
    this.session = session;
  }

  static create(workdir = getWorkdir()): AgentSession {
    return new AgentSession(Session.create(workdir));
  }

  async run(
    userPrompt: string,
    ctx: LoopContext,
    hooks: RunHooks,
  ): Promise<{ reply: string; turn: number }> {
    const loopCtx: LoopContext = { ...ctx, session: this.session };
    return new AgentRun(this.session, loopCtx, hooks).execute(userPrompt);
  }
}
