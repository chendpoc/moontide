# 日志系统开发实现文档

> **配套设计：** [`logging-design.md`](logging-design.md)。本文只讲**怎么做**；语义、不变量与「为什么不那样做」在设计文档里，不在此重复。
>
> **动手前必读：** 设计文档 §1（三类日志）、§2（不变量）、§4（分层与依赖方向）。
>
> **引用约定：** 下文 `不变量 N` 指设计文档 §2；`Dn` 指设计文档 §6 决策记录。

---

## 1. 阶段总览

七个阶段，**串行依赖**，每阶段独立可提交、可回滚。

| 阶段 | 内容 | 依赖 | 行为变化 |
|------|------|------|----------|
| **P0** | 合并 `@moontide/log` 进 `packages/agent/src/log/` | — | 无（纯机械） |
| **P1** | Fact log commit 协议 | `fact-log-projections.md` §6.3 定稿 | 有 |
| **P2** | 观测止血：`emit` 永不抛 + 失败 run 必封存 | P0 | 有 |
| **P3** | 去全局态：`RunLogger` | P0 | 有 |
| **P4** | Diagnostic snapshot 取代 debug 文件 | P3（需 `llmCallId`） | 有 |
| **P5** | Observation 存储：布局 / header / 回收 / `owner.lock` | P3 | 有 |
| **P6** | 读侧：`RunLogReader` + CLI 出口 | P5（布局定稿） | 新增能力 |

**为什么 P0 在最前（D13）：** 合包是纯机械操作，先做完，后续所有阶段只在最终位置工作，`§2` 的路径无歧义、无双路径、无兼容层。这与「等代码瘦身后再搬能少搬一点」的排期直觉相反 —— 但搬移成本是机械的，而路径歧义的成本会乘在后面六个阶段上。

**为什么 P3 在 P4/P5 之前：** `RunLogger` 是 `llmCallId`（P4 配对键）和 per-run 隔离（P5 分目录）的共同前提。先去全局态，后面两个阶段才不需要临时兼容手段。

**P1 可与 P2–P6 并行**：它动的是 `session/` 与 `harness/`，与观测链路无文件重叠。若 §6.3 未定稿，不要为了推进而自行发明 commit 协议。

---

## 2. 分阶段实现

### P0 — 合并 `@moontide/log` 进 `packages/agent`

**目标：** 消灭 `packages/log` 包，代码进 `packages/agent/src/log/`，公开出口改为 `@moontide/agent/observability`。**零行为变化**，diff 应全部是移动与 import 改写。

`packages/agent/src/log/index.ts` 现在已经是 `@moontide/log` 的再导出门面，所以这一步本质是把门面后面的实现搬到门面旁边。

#### 移动（无重名冲突，`index.ts` 除外）

| 源 | 目标 |
|----|------|
| `packages/log/src/event-hub.ts` | `packages/agent/src/log/event-hub.ts` |
| `packages/log/src/run.ts` | `packages/agent/src/log/run.ts` |
| `packages/log/src/types.ts` | `packages/agent/src/log/types.ts` |
| `packages/log/src/enrich.ts` | `packages/agent/src/log/enrich.ts` |
| `packages/log/src/persist.ts` | `packages/agent/src/log/persist.ts` |
| `packages/log/src/setup.ts` | `packages/agent/src/log/setup.ts` |
| `packages/log/src/outputs/jsonl.ts` | `packages/agent/src/log/outputs/jsonl.ts` |

`packages/log/src/index.ts` 不移动 —— 其内容合并进已存在的 `packages/agent/src/log/index.ts`（把 `from "@moontide/log"` 改成 `from "./event-hub.js"` 等本地相对路径）。

#### 删除

`packages/log/` 整个目录（含 `dist/`、`package.json`、两个 `tsconfig`）。

#### 新增

| 路径 | 内容 |
|------|------|
| `packages/agent/src/observability.ts` | `@moontide/agent/observability` 的入口，re-export `AgentEvent` 等类型、`EventOutput`、`JsonlWriter`、outputs 装配（D18） |

#### import 改写（共 5 处 workspace 消费方）

| 消费方 | 现状 | 改为 |
|--------|------|------|
| `packages/agent/src/**`（9 文件） | `from "@moontide/log"` | 相对路径 `../log/index.js` 等 |
| `packages/agent-cli/src/**`（11 文件） | `from "@moontide/log"` | `from "@moontide/agent/observability"` |
| `packages/evals/src/moontide-harness.ts` | `from "@moontide/log"` | collector 走 `@moontide/agent/testing`；`AgentEvent` 走 `@moontide/agent/observability` |
| `tests/{event-enrich,event-storage,setup-outputs}.test.ts` | `from "@moontide/log"` | 同 agent-cli |
| `tests/conformance/architecture-boundaries.test.ts` | 见下 | 见下 |

`packages/evals/src/moontide-harness.ts` 还用了 `getRunId()` —— P0 阶段先照搬（此时全局仍在），P3 一并处理。

#### 配置改写

| 路径 | 改动 |
|------|------|
| `packages/agent/package.json` | 删 `@moontide/log` 依赖；`exports` 加 `./observability` → `./dist/observability.{d.ts,js}` |
| `packages/agent-cli/package.json` | 删 `@moontide/log` 依赖 |
| `packages/evals/package.json` | 删 `@moontide/log` 依赖 |
| `packages/agent/tsconfig.build.json`、`packages/agent-cli/tsconfig.build.json` | 删 `"@moontide/log"` paths 映射 |
| `tsconfig.dev.json` | 删 `"@moontide/log"` paths 映射 |
| `vitest.config.ts`、`packages/evals/vitest.config.ts` | 删 `@moontide/log` alias |
| `pnpm-lock.yaml` | `pnpm install` 重新生成 |

#### conformance 改写（`tests/conformance/architecture-boundaries.test.ts`）

**这一步是 P0 唯一需要判断而非机械操作的地方。**

| 现有断言 | 处置 |
|----------|------|
| `@moontide/log does not import agent/ or config`（L55） | **改路径并收窄范围**。目标目录内只有**核心文件**（`event-hub` / `run` / `persist` / `enrich` / `types` / `setup` / `outputs/` / 后续 `storage/`）受此约束；`run-event-derive.ts` / `event-outputs.ts` / `publish-agent-error.ts` 是适配层，**合法** import agent 内部（`run-event-derive.ts:3` 已 import `../agent/harness/message-map.js`）。按文件白名单扫描，不要扫整个 `src/log/` |
| `src/ does not import monolith log core (use @moontide/log)`（L65） | 保留，消息改为「use `@moontide/agent/observability`」 |
| `@moontide/session does not import config or @moontide/log`（L43） | `logImport` 正则失效但无害；`legacyLogImport`（`.*log\/`）仍守住 session 不 import log |
| `session/ does not emit Agent Events`（L79） | 无需改，正则与位置无关 |
| `ToolArgumentStatus` packageRoots 含 `packages/log/src`（L449） | 删该条（已被 `packages/agent/src` 覆盖） |

新增一条：`@moontide/agent 根出口不导出观测 API`（守 D18）—— 断言 `packages/agent/src/index.ts` 不含 `AgentEvent` / `JsonlWriter` / `EventOutput`。

#### 验收

- `pnpm run check` 全绿
- `pnpm run test:conformance` 全绿
- `rg "@moontide/log" --glob '!node_modules' --glob '!docs' --glob '!pnpm-lock.yaml' .` 无结果
- **diff 审查**：除 import 行、`index.ts`、配置与 conformance 外无逻辑改动

#### 提交边界

单个提交。`feat(agent): merge log package into agent/src/log`。

---

### P1 — Fact log commit 协议

**目标：** 不变量 7 —— fact log 写失败必须可见，内存状态不得领先磁盘。

**前置：** [`fact-log-projections.md`](../session/fact-log-projections.md) §6.3 的 `MessageCommitEffect` 定稿。**该协议不由本文拥有**，本文只列落地点与验收。

#### 已核实的缺陷

| # | 位置 | 问题 |
|---|------|------|
| F1 | `packages/agent/src/agent/harness/run-commit-port.ts:30` | `void _commitMessage(...)` —— fire-and-forget，写失败无人知 |
| F2 | `packages/session/src/session.ts:293` | `pushMessage` 先 push 内存再 await 持久化 —— 崩溃后内存领先磁盘 |
| F3 | `AgentCore` 的 `RunEventBus.publish` | 不 await listener（**这是正确的**，见 D15；F1/F2 不能靠改它解决） |

#### 关键点

commit 走**独立的 awaited critical effect**，不要把 `RunEventBus.publish` 改成 await 全部 listener（D15）—— UI projection 与 observation derive 必须保持 fire-and-forget。

`session.ts` 的顺序改为**先持久化成功、再更新内存**。

#### 验收

- 注入写失败的 fake store，run 以错误结束且错误可见
- UI listener 抛错或 sleep 不影响 run 完成时间与结果（关键路径隔离）
- 崩溃点注入测试：持久化失败后内存不含该条 item

#### 提交边界

拆两个提交：`fix(session): commit before memory update`、`fix(agent): await message commit effect`。

---

### P2 — 观测止血

**目标：** 不变量 3、4。这一步不改存储格式，只保证观测链路不会杀 run、不会漏封存。

#### 已核实的缺陷

| # | 位置 | 问题 |
|---|------|------|
| O1 | `packages/log/src/event-hub.ts` `_emit`（P0 后在 `agent/src/log/`） | 逐个调 `output.handle(event)` **无 try/catch** —— 任一 output 抛错传播给 `emit` 调用方，即 agent 执行路径 |
| O2 | `finalizeRunOutputs` 的调用点 | 失败 run 是否必然封存未被测试覆盖 |

#### 实现

`_emit` 对每个 output 与 listener 单独 try/catch，失败则**跳过该 output 并继续**。

**降级告警不得走两条路：** 不得经 `emit` 自身上报（不变量 3，会递归失败），也**不得直接 `process.stderr.write`** —— conformance L194 断言 `@moontide/agent` 不直写 stderr。因此需要注入式 sink：

```ts
export interface ObservationFailureSink {
  (failure: { output: string; error: unknown }): void;
}
export function setObservationFailureSink(sink: ObservationFailureSink | null): void;
```

默认 `null`（静默丢弃）。`agent-cli` 在装配 outputs 时注入一个写 stderr 的实现。

`run_end` 的封存改为 `finally` 语义：无论 outcome 如何都调用 `finalizeRunOutputs`。

#### 验收

- output 的 `handle` 抛错时 `emit` 不抛，且其余 output 仍收到事件
- run 以失败结束时 active 文件仍被封存
- 降级 sink 未注入时不抛、不写 stderr

#### 提交边界

`fix(agent): isolate observation output failures from run path`。

---

### P3 — 去全局态：`RunLogger`

**目标：** D11 的三个职责降级中的第三条 —— 消灭 `log/src/run.ts` 的模块级 `runId` / `seq`，改为 per-run 实例。这是并发 run 与 server 化的前提。

#### 已核实的缺陷

| # | 位置 | 问题 |
|---|------|------|
| G1 | `packages/log/src/run.ts`（P0 后在 `agent/src/log/run.ts`） | 模块级 `let runId` / `seq`，两个并发 run 串台 |
| G2 | `packages/agent-cli/src/cli/statusline/collect.ts:48` | `session_id: snapshot.runId` —— 把 runId 当 sessionId 用。P3 提供真 sessionId 后修掉 |

#### 关键签名

```ts
export interface RunLoggerOptions {
  runId: string;
  sessionId: string;
  outputs: readonly EventOutput[];
}

export interface RunLogger {
  readonly runId: string;
  readonly sessionId: string;
  emit(draft: EventDraft): AgentEvent;
  finalize(): void;
  /** 单调递增，用于 Diagnostic snapshot 的配对键（P4）。 */
  nextLlmCallId(): string;
}

export function createRunLogger(options: RunLoggerOptions): RunLogger;
```

#### 传递路径（D7）

**构造参数 + observer dispatch context**。禁止两条捷径：

- 塞进 `RunEvent` —— `@moontide/run-protocol` 是纯类型 + 常量的执行协议，观测关注点不得渗入
- 挂 `AgentRuntime` 字段 —— runtime 是 process 级，挂 per-run 对象会重新引入串台。（`eventOutputs` 是 process 级装配，留在 runtime 是对的）

#### 改动

| 动作 | 路径 |
|------|------|
| 新增 | `packages/agent/src/log/run-logger.ts` |
| 改 | `packages/agent/src/log/run.ts` — 删全局 `runId` / `seq` / `resetRun` / `getRunId` / `setOnResetRun`，保留纯函数 envelope 组装 |
| 改 | `packages/agent/src/log/run-event-derive.ts` — 用注入的 `RunLogger` 取代 `emit` / `getRunId` / `resetRun` |
| 改 | `packages/agent/src/log/publish-agent-error.ts` — 同上 |
| 改 | `packages/agent/src/agent/run-observers/{types,phases,parse-events}.ts` — dispatch context 带 `RunLogger` |
| 改 | `packages/agent/src/agent/agent-run.ts` — 创建 / finalize `RunLogger` |
| 改 | `packages/agent-cli/src/cli/statusline/collect.ts` — 修 G2，`session_id` 用真 sessionId |
| 改 | `packages/agent-cli/src/log/format/format-error.ts` — 不再用 `getRunId()` |
| 改 | `packages/evals/src/moontide-harness.ts` — 不再用 `getRunId()` |
| 改 | `packages/agent/src/plugins/builtin/{context/metrics,tool-use-log/module}.ts` — 经 context 取 logger |

#### 顺带完成

新增 `AgentKind: "llm_call"` 与 `AgentKind: "error"`（D17）到 `packages/agent/src/log/types.ts`，并让 `llm_call_end` 的小元数据（usage / 耗时）derive 进 runs jsonl。这是 P4 删 debug 文件的前置 —— 否则删掉即丢信息。

`AgentKind: "error"` 只给顶层错误（provider / commit / REPL / config）；`plugin_error` 保留给 observer / plugin，不要合并。

#### 验收

- 两个并发 run 的 seq 与 runId 不串台
- `rg "getRunId|resetRun" packages/` 无结果
- `status.json` 的 `session_id` 与 `run_id` 是两个独立且正确的字段
- `llm_call_end` 的 usage 出现在 runs jsonl

#### 提交边界

三个提交：`feat(agent): add AgentKind llm_call and error`、`refactor(agent): replace global run state with RunLogger`、`fix(cli): report real sessionId in statusline`。

---

### P4 — Diagnostic snapshot 取代 debug 文件

**目标：** 不变量 6、8。debug 从「append 的日志」变成「最近三次 LLM 往返的覆盖写快照」（D4），默认开启，占用 O(1)。

#### 关键签名

```ts
export interface LlmCallSnapshot {
  version: 1;
  at: string;
  sessionId: string;
  runId: string;
  llmCallId: string;
  turn: number;
  request: LLMRequest;
  outcome?: unknown;
  tokens: { system: number; tools: number; messages: number; total: number };
}

/** compose 完成后写 pending 文件（在途现场）。 */
export function writePendingSnapshot(snapshot: LlmCallSnapshot, workdir?: string): void;

/** llm_call_end 时补 outcome 并原子 rename 进槽位。 */
export function promotePendingSnapshot(
  runId: string,
  llmCallId: string,
  outcome: unknown,
  workdir?: string,
): void;

/** 启动时清理上次进程遗留的 pending。 */
export function cleanupPendingSnapshots(workdir?: string): void;
```

#### 协议（D16）

1. `composeComplete` → `writePendingSnapshot`，落 `.moontide/debug/pending/<runId>-<llmCallId>.json`
2. `llm_call_end` → 读回 pending、补 `outcome`、**原子 rename** 进 `.moontide/debug/last-llm-call-<0..2>.json`，轮替最旧槽位
3. 进程启动 → `cleanupPendingSnapshots`

这样并发不互相覆盖（键含 runId + llmCallId）、长调用挂住时 pending 就是现场、崩溃在调用中时 pending 留痕。写失败**静默忽略**（设计文档 §4）。

#### 改动

| 动作 | 路径 | 说明 |
|------|------|------|
| 新增 | `packages/agent/src/context-inspect/snapshot-store.ts` | 上述三个函数 |
| 删除 | `packages/agent/src/context-inspect/debug-file.ts` | append 式 debug 文件 |
| 改 | `packages/agent/src/context-inspect/debug-emit.ts` | 改调 snapshot-store |
| 改 | `packages/agent/src/context-inspect/debug-mode.ts` | `DebugLevel` 语义改为「快照默认开」 |
| 改 | `packages/agent/src/context-inspect/debug-format.ts` | 读快照渲染 |
| 改 | `packages/shared/src/constants/storage.ts` | 加 `DEBUG_DIR` / `PENDING_DIR` / `LLM_CALL_SLOT_COUNT = 3` |
| 改 | `packages/agent-cli/src/cli/commands/registry.ts` | `/debug` 改为读快照 |

**注意：** `packages/shared/src/constants/debug.ts` 与 `context-inspect/debug-*.ts` 当前有其他会话的未暂存改动，动手前先 `git status` 确认（`AGENTS.md` §Git）。

#### 顺带完成：终端 dump

`.moontide/debug/last-terminal.json` —— 覆盖写当前渲染行快照，参考 pi 的 `/debug`。属 `agent-cli` 侧（`shared/constants/debug.ts` 已注明 file-only、不含 terminal dump），独立提交。

#### 验收

- 连续 5 次 LLM 调用后 `.moontide/debug/` 仍只有 3 个槽文件（不变量 6）
- 每个槽文件的 `request` 与 `outcome` 同属一次调用（不变量 8）
- 并发两个 run 各自的 pending 不互相覆盖
- 杀进程于调用中：pending 文件存在且含 `request`
- 快照写失败（目录只读）时 run 正常完成

#### 提交边界

`feat(agent): replace debug file with llm call snapshots`、`feat(cli): dump rendered terminal lines`。

---

### P5 — Observation 存储：布局、header、回收、归属

**目标：** D3 的按 session 分目录与双层配额、不变量 9 的 segment header、D2 的 `owner.lock`。

#### 已核实的缺陷

| # | 位置 | 问题 |
|---|------|------|
| S1 | `packages/log/src/outputs/jsonl.ts`（P0 后在 `agent/src/log/outputs/`） | 扁平 `runs/<runId>`，`MAX_COMPLETED_RUNS = 20` 全局配额 —— 活跃 session 的旧 run 会被另一 session 的新 run 挤掉 |
| S2 | 同上 | segment 无 header，无 schema 版本，reader 无法判断能否读 |
| S3 | `packages/session/src/` | 无 session 归属保护，两个进程可逻辑上共用一段历史 |

#### 布局改动

`runs/<runId>-NNNN.jsonl.gz` → `runs/<sessionId>/<runId>-NNNN.jsonl.gz`。回收改为**每 session 配额 + 全局兜底上限**（总压缩字节数与总 session 目录数），超限时按 mtime 删最旧 session 的最旧 run。纯 per-session 配额没有上界（D3）。

#### segment 结构

每个 segment **第一行是 header**（不变量 9），含 `version` / `sessionId` / `runId` / `segment` / `createdAt`。**初次创建与每次 rotation 后都要重建 header** —— 这是最容易漏的一处，rotation 路径必须写 header 再写第一条事件。

#### 归属（D2）

```ts
/** 中性原语，加进已有的 shared/src/utils/process.ts。 */
export function isProcessAlive(pid: number): boolean;

export interface SessionOwner {
  pid: number;
  ownerToken: string;
  startedAt: string;
}

/** O_EXCL 原子创建 + CAS 重试；stale 锁（进程已死或 token 不符）可回收。 */
export function acquireSessionOwner(sessionId: string, workdir?: string): SessionOwner;
export function releaseSessionOwner(owner: SessionOwner, workdir?: string): void;
```

用 `ownerToken`（随机串）而非 `startedAt` 做活性判定 —— 仅靠 pid 会被 pid 复用骗过，而查真实进程启动时间要跨平台读 `/proc` 或 `ps`，代价不成比例（D2、设计文档 §6.3 第二轮）。

归属是 **Session 级不变量**：`Session.open` 获取、`Session.close` 释放，**eval 与 headless 路径同样经过**，不要只在 REPL 接线。不做逐条 fsync（D2）。

#### 改动

| 动作 | 路径 | 说明 |
|------|------|------|
| 新增 | `packages/agent/src/log/storage/segments.ts` | 分段 / gzip / header / 恢复。**留在 agent，不下沉 shared**（D14：没有第二个消费者） |
| 新增 | `packages/agent/src/log/storage/retention.ts` | 双层配额回收 |
| 改 | `packages/agent/src/log/outputs/jsonl.ts` | 改用 `storage/`，写入按 sessionId 路由 |
| 新增 | `packages/session/src/owner.ts` | `acquireSessionOwner` / `releaseSessionOwner` |
| 改 | `packages/session/src/session.ts` | `open` / `close` 接线归属 |
| 改 | `packages/session/src/paths.ts` | `owner.lock` 路径 |
| 改 | `packages/shared/src/utils/process.ts` | 加 `isProcessAlive` |
| 改 | `packages/shared/src/constants/storage.ts` | 加 per-session 配额与全局上限常量 |

#### 验收

- header round-trip：初次创建与 rotation 后的 active 首行都是 header；reader 拒绝未知 `version`
- 两个 session 交替产生 run 时，都不会被对方挤掉
- 全局上限生效：制造超量数据后总占用有界
- 并发 `acquireSessionOwner` 只有一个成功
- stale 锁（进程已死）可回收；pid 复用但 token 不符时**不**误判为自己的锁
- `close` / 进程退出后无 `owner.lock` 残留
- eval 与 headless 路径同样受归属保护

#### 提交边界

四个提交：`feat(agent): add observation segment store with header`、`feat(agent): scope run logs by session with global cap`、`feat(session): add owner lock`、`feat(shared): add isProcessAlive`。

---

### P6 — 读侧

**目标：** 补上当前完全缺失的读能力 —— 压缩后的 run 日志现在无法通过任何代码路径读回。

#### 关键签名

```ts
export interface RunLogSummary {
  sessionId: string;
  runId: string;
  startedAt: string;
  endedAt?: string;
  eventCount: number;
  segments: number;
}

export interface RunLogReader {
  listRuns(sessionId?: string): Promise<readonly RunLogSummary[]>;
  /** 跨 active + 已封存 gz segment 按序读回，自动解压。 */
  readRun(sessionId: string, runId: string): AsyncIterable<PersistedAgentEvent>;
}

export function createRunLogReader(workdir?: string): RunLogReader;
```

消费者：`/debug` 复盘、故障复盘工具、未来的 UI。**`/resume` 不是消费者** —— 它读 Session Item Log（fact），不读观测日志。

#### 改动

| 动作 | 路径 |
|------|------|
| 新增 | `packages/agent/src/log/reader.ts` |
| 改 | `packages/agent/src/observability.ts` — 导出 reader |
| 改 | `packages/agent-cli/src/cli/commands/registry.ts` — 加读侧命令 |

#### 验收

- 能读回含多个 gz segment + 一个 active 的完整 run，顺序与写入一致
- header `version` 未知时明确报错而非静默跳过
- `listRuns()` 不传 sessionId 时跨 session 列举

#### 提交边界

`feat(agent): add RunLogReader`、`feat(cli): read historical run logs`。

---

## 3. 缺陷索引

| # | 阶段 | 位置 | 问题 |
|---|------|------|------|
| F1 | P1 | `agent/src/agent/harness/run-commit-port.ts:30` | fact commit fire-and-forget |
| F2 | P1 | `session/src/session.ts:293` | 内存领先磁盘 |
| F3 | P1 | `RunEventBus.publish` | 不 await（**正确**，不要改，见 D15） |
| O1 | P2 | `log/src/event-hub.ts` `_emit` | output 抛错传播进执行路径 |
| O2 | P2 | `finalizeRunOutputs` 调用点 | 失败 run 封存未覆盖 |
| G1 | P3 | `log/src/run.ts` | 模块级 `runId` / `seq` |
| G2 | P3 | `agent-cli/src/cli/statusline/collect.ts:48` | `session_id: snapshot.runId` |
| S1 | P5 | `log/src/outputs/jsonl.ts` | 扁平布局 + 全局 20 run 配额 |
| S2 | P5 | 同上 | segment 无 header / 无版本 |
| S3 | P5 | `session/src/` | 无归属保护 |
| R1 | P6 | — | gz segment 无任何读路径 |

---

## 4. 文档同步

| 时机 | 文档 | 改动 |
|------|------|------|
| P0 | `docs/notes/runtime/monorepo-packages.md` | 删 `@moontide/log` 条目 |
| P0 | `docs/notes/runtime/agent-harness-cli-split.md` | 4 处 `@moontide/log` 引用改为 `@moontide/agent/observability` |
| P0 | `docs/spec/type-imports.md`、`docs/spec/agent-events.md` | import 来源更新 |
| P0 | `packages/agent-core/README.md`、`packages/run-protocol/README.md`、`packages/evals/README.md` | 删除对 `@moontide/log` 包的引用 |
| P0 | `packages/agent/README.md` | 补 `observability` subpath |
| P3 | `docs/spec/agent-events.md` | `runId` 不再是「storage routing key」（D11）；补 `llm_call` / `error` kind |
| P4 | `docs/notes/context/context-inspect-debug.md` | 标记被本设计取代 |
| P5 | `docs/spec/agent-events.md` | 存储布局与 header 结构 |
| 全部完成 | `docs/spec/logging.md` | `logging-design.md` 过验收后提升为 spec |
| 全部完成 | `docs/notes/README.md` | 登记本文与设计文档两个条目 |

`docs/notes/README.md` 与 `docs/spec/README.md` 当前有其他会话的未暂存改动，登记前先确认。

---

## 5. 后续候选（不在本计划内）

**CLI 用户可见输出的去重与折叠** —— Vite 的 `createLogger` 有 `warnOnce` 与重复折叠 `(x3)`，MoonTide 的 Transcript 目前没有。这属于终端渲染域，由 [`repl-terminal.md`](../../spec/repl-terminal.md) 管，与本文的持久化分层无耦合，单独提案。设计文档 §5 记了它的机制作为参考，但它**不是**本计划的阶段之一。

---

## 6. 命令

| 用途 | 命令 |
|------|------|
| 每阶段收尾（完整输出，修完所有 lint / type / test） | `pnpm run check` |
| 单测试文件迭代 | `pnpm exec vitest run tests/<name>.test.ts` |
| 规范单测（P0 必跑） | `pnpm run test:conformance` |
| 确认合包无残留 | `rg "@moontide/log" --glob '!node_modules' --glob '!docs' .` |

不跑全量 `pnpm test`、不跑 `pnpm run build`，除非用户要求（`AGENTS.md` §命令）。
