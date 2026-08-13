# 日志系统设计（候选）

> **状态：** 候选设计，尚未实现。通过 §7 验收后提升为 `docs/spec/logging.md`。
>
> **本文范围：** 语义分层、不变量、存储布局、依赖方向与**决策记录**。
> 逐阶段的执行步骤、签名与文件清单见 [`logging-implementation.md`](logging-implementation.md)。
>
> **落地后取代：** [`../context/context-inspect-debug.md`](../context/context-inspect-debug.md) 的 debug dump 方案。
>
> **沿用：** Agent Event 的字段级 schema 以 [`../../spec/agent-events.md`](../../spec/agent-events.md) 为准。
>
> **前置依赖：** Fact log 的 durability 契约依赖 [`../session/fact-log-projections.md`](../session/fact-log-projections.md) §6.3 的 Harness commit 协议定稿。该协议不属本文，本文只声明依赖。

---

## 1. 三类日志

按**事实性 / 写失败后果**分层，而不是按内容分。这决定写入策略，是本设计的地基。

| 类别 | 事实源 | 写失败该怎样 | key | 保留 |
|------|--------|--------------|-----|------|
| **Fact log**<br>Session Item Log | 是。丢一行 = context 损坏 | **冒泡为错误** | sessionId | 用户数据，不自动删 |
| **Observation log**<br>Agent Event Log | 否，可由 RunEvent 重新派生 | **永不 throw**，降级丢弃 | sessionId / runId | 有界回收 |
| **Diagnostic snapshot**<br>LLM 往返全文 | 否，纯诊断现场 | 永不 throw | 最近 3 次调用 | O(1)，覆盖写 |

Fact 与 Observation 的**错误策略相反**是这张表最重要的一条，也是 D10 决定不为二者抽公共 store 的原因。

---

## 2. 不变量

1. **Session Item Log append-only**；Agent Event 永不反写 Session（已成立，见 [`context-composer.md` §4](../../spec/context-composer.md)）。
2. **`message_update` 是渲染协议**，永不进任何持久化日志（已成立）。
3. **观测与诊断的写入失败对 run 结果不可见** —— 观测不得杀 run；**且其降级告警不得经观测通道自身上报**（避免递归失败）。
4. **每个 run 的 observation log 在 `run_end` 必然封存**，与 outcome 无关。
5. **终端不承载 trace**（已成立，见 [`repl-terminal.md`](../../spec/repl-terminal.md) 不变量 3）。
6. **Diagnostic snapshot 的磁盘占用是 O(1)** —— 覆盖写，不累积。
7. **Fact log 写失败必须可见** —— commit 失败不得被静默丢弃。**当前不成立**。
8. **快照中的 `request` 与 `outcome` 必然同属一次 LLM 调用** —— 不存在撕裂的配对。
9. **每个 observation segment 的首行是 header** —— 含初次创建与每次 rotation 后重建。

---

## 3. 存储布局

| 路径 | 类别 | 写入模式 | 保留 |
|------|------|----------|------|
| `.moontide/sessions/<sessionId>.jsonl` | Fact | append（`replaceAll` 仅 import replace 模式） | 不自动删 |
| `.moontide/sessions/<sessionId>/owner.lock` | Fact 辅助 | `O_EXCL` 原子创建 | 随 session，close 时 release |
| `.moontide/runs/<sessionId>/<runId>.active.jsonl` | Observation | append（首行 header） | 封存后删除 |
| `.moontide/runs/<sessionId>/<runId>-NNNN.jsonl.gz` | Observation | 分段封存 + gzip | session 配额 + 全局上限 |
| `.moontide/debug/pending/<runId>-<llmCallId>.json` | Diagnostic | 写一次，提升后删除 | 在途；启动时清理 |
| `.moontide/debug/last-llm-call-<0..2>.json` | Diagnostic | rename 提升 + 轮替 | **workspace 级**恒 3 份 |
| `.moontide/debug/last-terminal.json` | Diagnostic | 覆盖写 | 1 份 |
| `.moontide/status.json` | CLI UI 状态 | 覆盖写 | — |

**回收策略（D3）：** 每 session 保留最近 N 个 completed run；**另设全局上限**（总压缩字节数 + 总 session 目录数），超出时按 mtime 删最旧 session 的最旧 run。只有 per-session 配额会让总占用随 session 数线性增长。

**快照作用域（D16）：** 三个槽是 **workspace 最近三次 LLM 调用**，不按 session 分 —— debug 的使用场景是「刚才那次出问题了」，跨 session 区分反而增加查找成本。pending 文件按 `runId + llmCallId` 命名，所以并发不会互相覆盖。

路径常量集中在 [`packages/shared/src/constants/storage.ts`](../../../packages/shared/src/constants/storage.ts)；session 域路径见 [`packages/session/src/paths.ts`](../../../packages/session/src/paths.ts)。

---

## 4. 分层与依赖方向

| 层 | 职责 | 禁止 |
|----|------|------|
| `shared/` | 路径常量、文件与 gzip **中性原语** | 业务语义、依赖错误发布、segment 编排（D14） |
| `session/` | Fact log schema + writer/reader + ownership；失败上抛 | import `agent/`、import log |
| `context-composer/` | compose | import log |
| `agent/src/log/` | Observation envelope + RunLogger + storage + outputs + reader + derive；失败降级 | 直接 `node:fs`（经 shared） |
| `agent/` 其余 | 装配 outputs、policy 决策、快照 | 直接 `node:fs` |
| `agent-cli/` | 终端渲染这一个 sink + 终端 dump | 落盘业务日志 |

Observation log **不是独立包**（D12）。conformance 要守的是**消费侧**方向：`session/` 与 `context-composer/` 不得 import log —— 这两条断言与 log 的物理位置无关。

三类日志的错误策略**各自实现，不共享基类**（D10、handbook §6）：

| 层 | 决定 |
|----|------|
| `session/` | Fact log 写失败 **上抛** |
| `agent/src/log/` | Observation 写失败 **降级**，告警走 stderr / status，**不走 `emit`** |
| `agent/src/context-inspect/` | Diagnostic 快照写失败 **静默忽略** |

### 公开出口（D18）

| 出口 | 内容 | 消费方 |
|------|------|--------|
| `@moontide/agent` | 正常 Harness API，**不含**观测内部件 | 一般调用方 |
| `@moontide/agent/observability` | `AgentEvent` 类型、`EventOutput`、`JsonlWriter`、`RunLogReader`、outputs 装配 | `agent-cli`、UI、故障复盘工具 |
| `@moontide/agent/testing` | `enableTestCollector` / `getCollectedEvents` / `disableTestCollector` | `evals`、tests |

---

## 5. 参考实现

| | 机制 | 落盘 | 可否照抄 |
|---|------|------|----------|
| **Vite** | `createDebugger` = `debug` 包薄封装，namespace `vite:*`，`DEBUG` env 启用，**未启用返回 `undefined`**；`createLogger` 独立管用户可见输出（级别 / `warnOnce` / 重复折叠 `(x3)`） | **不落盘**，只 stderr | 机制可抄，不落盘**不可**抄（D5） |
| **pi** | `/debug` 隐藏命令 30 行，`writeFileSync` 覆盖写固定路径，dump 渲染行 + `session.messages`；另有 `PI_DEBUG_REDRAW=1` 窄流 append 一行 | 覆盖写单文件 | **核心可抄**（D4） |

pi 的关键启发是它 dump 的是**内存里的 `session.messages`**，而不是另存一份日志 —— 因为事实源已经在 session jsonl 里了。MoonTide 同理，于是 debug 的职责收缩到只剩 LLM 往返全文。

Vite 的关键启发是**两套东西彻底分离**：`logger` 面向用户、有级别、去重；`debug` 面向开发者、namespace 过滤、零成本关闭。MoonTide 已有这个切分（Transcript vs 观测落盘），要守住不让它们互相渗透。

---

## 6. 决策记录

**被否决的方案与结论同等重要** —— 尤其 D4 与 D14，它们是本设计两次从复杂回归简单的转折点。

| # | 议题 | 结论 | 被否决的方案与理由 |
|---|------|------|--------------------|
| **D1** | 日志分层依据 | 按**事实性 / 写失败后果**分三类（§1） | 按内容分类（conversation / trace / context）。分类无法回答「写失败该怎么办」，而这恰恰是唯一需要在存储层区分的事 |
| **D2** | Fact log 并发保护 | session 归属 + `owner.lock`；**不做逐条 fsync** | ① `flock` 文件锁 —— POSIX `O_APPEND` 小写入本就原子，锁的收益极低；真正要防的是两个 run 逻辑上共用一段历史，那是 session 生命周期问题不是 IO 问题。② 逐条 fsync —— 丢最后一行只损失一轮对话，而 tool 密集 run 下逐条 fsync 显著拖慢 |
| **D3** | Observation log 的 key | 按 sessionId 分目录，session 配额 **+ 全局兜底上限** | ① 现状扁平 `runs/<runId>` + 全局 20 run 配额 —— 会让活跃 session 的旧 run 被另一个 session 的新 run 挤掉。② 纯 per-session 配额 —— 总占用随 session 数线性增长，无上界 |
| **D4** | debug 形态 | **覆盖写快照**，不累积 | 曾提出：内容寻址 blob（`sha256` 去重 system prompt / tools schema）+ 引用计数或 mark-and-sweep GC + write-then-GC 的 tail 决策 + 三档 `contentCapture`。**全部撤回** —— 这些机制都在解决「append 日志无界增长」派生出的问题，而一旦改成不累积的快照，问题本身就不存在。参考 pi 的实现后确认：debug 需要的是「最近一次现场」，不是「全部历史」 |
| **D5** | 是否照抄 Vite 的「debug 不落盘」 | 否，必须落盘 | Vite 是构建工具，复现一次构建两秒且确定性，流到 stderr 就够。agent run 花钱、慢、不确定，很多 bug 无法复现 —— 复现成本的量级差异决定了必须持久化 |
| **D6** | 是否按 roadmap M7 删掉 derive 层，直接持久化 RunEvent | 否，保留 derive | `context_metrics` / `plugin_error` 来自 observer，没有 RunEvent 对应物；删 derive 就得为观测数据发明 RunEvent 类型，而 `AGENTS.md` 明确规定插件不得定义 RunEvent phase。方向应是把 envelope 变薄，不是取消派生 |
| **D7** | per-run logger 的传递路径 | 经**构造参数 + observer dispatch context** 下传；**不挂 runtime**、不引入新的可变全局 | ① 塞进 `RunEvent` —— [`@moontide/run-protocol`](../../../packages/run-protocol/README.md) 是纯类型 + 常量、无 IO 的执行协议，观测关注点不得渗进内核协议。② 挂 `AgentRuntime` 字段 —— RunLogger 是 per-run 的，挂在 process 级 runtime 上会重新引入串台风险（`eventOutputs` 是 process 级装配，可以留在 runtime） |
| **D8** | Observation log 的 schema 版本 | 每个 segment **第一行**写 header（不变量 9） | 每条事件带 `version` 字段 —— 冗余；且 reader 需要的是「整个文件能不能读」这一次性判断 |
| **D9** | debug 与 Agent Event 是否统一 schema | 随 D4 作废 | 该问题的前提是 debug 也是一条事件流。快照化之后 debug 不再是 log，没有 schema 需要统一 |
| **D10** | Fact / Observation 的错误策略是否可共用一个抽象 | 否。**各自实现，策略不共享** | 曾提出带 `Durability` 语义的通用 `JsonlLogStore`，让公共层理解 `fact` / `observation` 并在失败时调 `publishError`。这会让底层依赖上层的错误发布能力，方向倒置；且与 handbook §6「相似 store 可各写一份，不为省行数抽泛型」冲突 |
| **D11** | `runId` 是否应该移除 | **概念保留，三个职责降级**（见下） | 用 `(sessionId, turn)` 取代 `runId`。不成立 —— **turn 在 run 内部**：一次 `AgentRun.execute` 对应一个用户 prompt，其中 `turn_start` 触发 N 次，两者是包含关系而非同级。且 `RunConfig` 每 run 冻结、`RunEventBus` 每 run 新建、`run_start` / `run_end` 成对，run 是真实的生命周期单位；`tests/run-storage.test.ts` 已把 run 隔离当不变量测 |
| **D12** | `@moontide/log` 是否该独立成包 | **否，合入 `packages/agent/src/log/`** | 保留独立包。判据是「有无独立于 agent 的领域」：`AgentEvent` schema 由 agent loop 产出什么决定，`persist` 剥离 `messageLines` / `system` / `tools` 是关于 agent context report 形状的知识 —— 没有 agent 就没有这个包的存在理由。对比 `session`（自有 fact log 领域）/ `llm` / `context-composer` / `run-protocol`，它们都有独立领域。曾用「conformance 守门」和「evals 依赖」反对合并，**两条都不成立**：前者是循环论证（测试因包存在而存在，且 `scanTsFiles` 的路径参数改一下即可继续守同样约束）；后者 evals 本就依赖 `@moontide/agent` |
| **D13** | 合包怎么迁移 | **一次性搬移 + 改 import + 删包，作为最前面的 P0**；不做兼容层、不做双路径 | ① 先在 `packages/log` 新增文件、最后整体搬走 —— 等于往一个已决定删除的包里写新代码。② target-first + 过渡期兼容 re-export —— 兼容层只能是消费方逐个改 import（log 不能 re-export agent，否则违反边界断言），实际收益为零却让后续所有阶段存在双路径。**既然不需要兼容，直接搬完再动手**：后续阶段只在最终位置工作，[`logging-implementation.md`](logging-implementation.md) §2 的文件清单无歧义 |
| **D14** | segment 机制（分段 / gzip / 回收 / 恢复）是否下沉 `shared/` | **否，留在 `agent/src/log/storage/`** | 曾计划下沉为 `shared/storage/jsonl-segments.ts`。**没有第二个消费者**：Session Item Log 不分段、Diagnostic snapshot 不是 jsonl，只有 Observation log 用得上。该下沉的原始动机（「session 拿到 durability 语义、debug 免费拿到轮转」）在 D2 否决 fsync、D4 把 debug 改成快照之后就已失效，是提前抽象。`shared/` 只保留已有的中性原语 |
| **D15** | Fact log durability 是否靠「让 RunEvent bus 变 awaited」实现 | **否**。独立的 awaited critical effect（`MessageCommitEffect`），bus 保持 fire-and-forget | 把 `RunEventBus.publish` 改成 await 全部 listener。RunEvent listener 的错误语义是**异质**的 —— session commit 是关键路径，UI projection 与 observation derive 必须不得阻塞执行。统一 await 会让 UI 或观测的慢/失败卡住内核。这也与 `fact-log-projections.md` §6.3 已记的「注入 provider-neutral `MessageCommitEffect`」一致 |
| **D16** | 快照的 request / outcome 如何配对 | **pending 文件 → 原子 rename 提升为槽位**，键为 `runId + llmCallId` | ① 「compose 写 request，`llm_call_end` 回填 outcome」—— 并发 run 会在中间轮替槽位，且 `turn` 不足以标识一次 LLM 调用（同 turn 可能重试）。② 纯内存缓冲到 `llm_call_end` 再一次写 —— 简单，但长时间 LLM 调用**挂住**（不是崩溃）时无任何在途现场可查，而这正是需要 debug 的场景之一 |
| **D17** | 顶层错误是否复用 `plugin_error` | **否，新增 `AgentKind: "error"`** | 让所有 `reportError` 都 emit `plugin_error`。会把 provider / session commit / REPL / config 错误全部误分类成插件错误，污染 grep 与 UI 归类。`plugin_error` 只保留给 observer / plugin |
| **D18** | 合包后的公开出口 | 新增 `@moontide/agent/observability` subpath；collector 留 `./testing`；根出口不变 | 把 `AgentEvent` / reader / writer / collector 全塞进根出口 —— 会把 Harness 的公开 API 面撑大一圈 |

### 6.1 `runId` 降级的三个职责（D11）

「移除 `runId`」指的是下列职责转移，**不是移除概念本身**。

| 职责 | 现状 | 目标 |
|------|------|------|
| 存储路由键 | `runId` 直接定位文件（`agent-events.md` 写「Run identifier and storage routing key」） | **sessionId 才是路由键**；`runId` 退化为 segment 文件名 stem |
| 回收单位 | 全局「最近 20 个 run」 | 每 session 配额 + 全局兜底上限 |
| process 级全局状态 | `packages/log/src/run.ts` 模块级 `let runId` | per-run `RunLogger` 实例字段 |

### 6.2 为什么快照够用，以及它必须装什么（D4 / D16）

Session Item Log 已有全部消息，Agent Event Log 已有观测事件。debug 真正独有、两者都没有的是**一次 LLM 往返的全文** —— 编译产物 `LLMRequest` 加上 provider 返回的 `outcome`。[`context-composer.md`](../../spec/context-composer.md) 规定「编译产物 immutable，每 turn 新建」，而它从未被持久化；`LlmCallEndRecord`（`{ turn, request, outcome }`）目前也只存在于将被删除的 debug 通道里。一次往返的大小上界是 context window，所以覆盖写是 O(1)。

pending → 提升协议同时解决三件事：**并发不互相覆盖**（pending 按 run + call 命名）、**在途可查**（长 LLM 调用挂住时 pending 文件就是现场）、**崩溃留痕**（进程死在调用中，pending 仍在）。并发下两个 run 同时提升时槽位轮替仍可能交错，但每个槽文件永远是一次完整调用的 `{ request, outcome }` —— 不变量 8 保的是「不撕裂」，不是「严格时间有序」。

### 6.3 外部 review 回应（两轮）

**第一轮**

| 项 | 判定 | 处置 |
|----|------|------|
| Fact log 的 fire-and-forget commit 未纳入设计 | **成立**。已核实 [`run-commit-port.ts:30`](../../../packages/agent/src/agent/harness/run-commit-port.ts) `void _commitMessage(...)`、`RunEventBus.publish` 不 await listener、[`session.ts:293`](../../../packages/session/src/session.ts) `pushMessage` 先 push 再 await | 独立阶段 + 声明前置依赖。设计归 [`fact-log-projections.md`](../session/fact-log-projections.md) §6.3，本文不重复拥有 |
| 落地顺序存在循环依赖（观测止血依赖后期的 `RunLogger`） | **成立** | 止血阶段改为兼容修复，不依赖 `RunLogger` |
| 删 `llm_call` 与 error debug 会丢失不可恢复信息 | **成立**。已核实 `AgentKind` 无 `llm_call`、derive 不处理 `llm_call_end`（仅 [`stream-fn.ts:46`](../../../packages/agent/src/agent/harness/stream-fn.ts) publish）、`reportError` 仅在传 `route` 时 emit | **处置与建议不同**：不扩大 debug 文件，而是小元数据补 derive 进 runs jsonl、大往返全文进快照 |
| `JsonlLogStore` 把业务错误策略下沉进 shared | **成立** | D10；第二轮进一步撤销整个下沉（D14） |
| `owner.lock` acquire 非原子、release 未接线 | **成立** | `O_EXCL` + CAS + release 接线 |
| `/resume` 不是 `RunLogReader` 的消费者 | **成立** | 从消费者列表移除 |
| 纯 per-session 配额无总量上界 | **成立** | 加全局兜底上限（D3） |

**第二轮**

| 项 | 判定 | 处置 |
|----|------|------|
| 新代码不应先写进即将删除的 `packages/log` | **成立** | D13。**进一步**：既然不需要兼容，直接把合包提到最前面一次做完 |
| `jsonl-segments` 下沉 shared 缺真实复用者 | **成立** | D14。`proc.ts` 因 session ownership 使用，留 shared |
| Fact log durability 不应通过 await 所有 RunEvent listener 实现 | **成立**。listener 错误语义异质 | D15。删除「改 `RunEventBus` 让 listener 失败可见」这一项 |
| 三槽快照的 request / outcome 配对在并发下不可靠 | **成立** | D16，并**细化**为 pending + 原子提升（而非纯内存缓冲），兼顾在途可查 |
| `owner.lock.startedAt` 无法用 `isProcessAlive` 验证 | **成立** | **选 `ownerToken` 方案**而非新增 `getProcessStartedAt`（后者跨平台要读 `/proc` 或 `ps`，代价不成比例）。ownership 定为 **Session 级**不变量 |
| 顶层错误不应统一记为 `plugin_error` | **成立** | D17。另采纳「observation output 自身写失败不得经同一 output 上报」—— 补进不变量 3 |
| 合包后公开出口需提前定义；segment API 缺 header 参数 | **成立** | D18；header 补成不变量 9 |

---

## 7. 提升为 spec 的验收条件

- 不变量 3（观测写入抛错不影响 run outcome，且降级告警不经观测通道）、4（失败 run 亦封存）、6（快照 O(1)）、7（Fact log 写失败可见）、8（快照配对不撕裂）、9（segment header）各有测试
- Fact log 阶段的关键路径隔离有测试：UI / 观测 listener 慢或失败**不**阻塞内核
- 被删的 debug 信息全部有新家且可验证：`llm_call` 元数据在 runs jsonl、往返全文在快照、无 route 的错误以 `error` kind 进 runs jsonl
- segment header round-trip：初次创建与 rotation 后重建的 active 首行都是 header；reader 拒绝未知 `version`
- `RunLogReader` 能读回含 gz segment 的完整 run
- `owner.lock`：并发 acquire 只有一个成功；stale 锁可回收；close / exit 后无残留；eval 与 headless 路径同样受保护
- 并发两个 run 时 seq / runId 不串台
- `status.json` 中 sessionId 与 runId 是两个独立且正确的字段（D11）
- `packages/agent` 内无直引 `node:fs` 的日志写入路径
- `@moontide/agent` 根出口未因合包新增观测 API（D18）
- 文档同步完成（[`logging-implementation.md`](logging-implementation.md) §4）
