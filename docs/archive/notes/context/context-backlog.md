
> Context Composer **演进特性**候选：优先级、设计要点、代价与阶段。  
> **非实现承诺** — 当前主路径见 [`context-window-roadmap.md`](context-window-roadmap.md)（六件事）；C6+ 之后择项见本文。

---

## 1. 目的与阅读顺序

| 顺序 | 文档 | 内容 |
|------|------|------|
| 0 | [`context-window-roadmap.md`](context-window-roadmap.md) | **当前开发计划**（六件事 **done** · §8 后续四条轨） |
| 1 | [`context-composer.md`](../../spec/context-composer.md) | 已定 Spec：Session Event Log、State Stores、Composer、Compaction / Checkpoint |
| 2 | **本文** | 分账、Structured IR、实验 Compose、backlog 特性、Deferred 项 |
| 3 | [`context-analysis.md`](context-analysis.md) | 行业 SOTA 与 CS 类比背景 |

---

## 2. 特性分级

```mermaid
flowchart LR
  Core["Core 扩展"]
  IR["Structured IR"]
  Exp["Experiment"]
  Backlog["Backlog"]
  Deferred["Deferred"]

  Core --> IR
  IR --> Exp
  Exp --> Backlog
  Backlog --> Deferred
```

| 级别 | 含义 |
|------|------|
| **Core 扩展** | 与 Composer 主路径绑定；建议在 C2+ 纳入 Spec 演进 |
| **优先方向** | Structured Session IR；与 C4 Compaction Record 对齐 |
| **Experiment** | 可选 feature flag；不阻塞 correctness |
| **Backlog** | 独立 feature；不阻塞 C1–C4 |
| **Deferred** | 讨论共识「当前忽略」；文档备查 |

---

## 3. Core：Context Budget Tiers（分账）

> **状态（2026-08）：** **done** — L1–L5 分账 · L2-scoped auto-prune · `/compact` 报告 L2 tok（§7.4）· L3 spill 集成 · manifest `budgetTiers` · inspect/statusline · `subAccounts.workingSet`。详见 [`context-composer.md` §16](../../spec/context-composer.md#16-context-budget-tiersmvp--2026-08)。

### 3.1 问题

单一 context 上限 + 全局 `percentUsed` 阈值时，**长对话或大 tool_result 会挤占** Instruction State、Tool Definitions 与输出预留，导致 system/tools 被 silent 压缩或截断。

### 3.2 设计

为 `LLMRequest` 各组成部分划定 **独立 token budget**（multi-ledger budgeting）：

| Tier | 名称 | 内容 | 策略 |
|------|------|------|------|
| **L1 Pinned** | 固定指令与工具 schema | Instruction State + Tool Definitions + 活跃 Compaction Record（若有） | **不参与** Compaction 压缩；超支时压 L2 或报错 |
| **L2 Dialogue** | 对话层 compose 输入 | `messages` 中 user / assistant / tool 可见部分 | prune / tail_window / summary |
| **L3 Reference** | 外置引用 | `ToolResultSummary`、短引用 | 全文 **never inline**；配额上限 |
| **L4 Reserved** | 输出预留 | 本轮 max output + thinking 头room | 从 `ModelProfile.contextWindow` **先扣减**，再分配 L1–L3 |

**Composer 填装顺序（概念）：**

```
C = ModelProfile.contextWindow
L4 = reservedOutput + reservedThinking
available = C - L4
分配 L1 → L3 → L2（L2 可 Compaction）
```

### 3.3 不是什么

- **不是**给每条内容贴 `[L1]` 标签让模型「优先处理」— 模型无 OS 式抢占；注意力主要靠 **位置**（system 前、recent tail 后）与 **是否 inline**。
- 分账解决的是 **工程 correctness（互不占配额）**；见 §5 Experiment 的编排实验。

### 3.4 Manifest 扩展

`ContextManifest` 增加 tier breakdown（示意）：

```typescript
export interface BudgetTierUsage {
  tier: "pinned" | "dialogue" | "reference" | "reserved";
  estimatedTokens: number;
  limitTokens: number;
}
```

### 3.5 依赖与阶段

| 项 | 说明 |
|----|------|
| 依赖 | `ModelProfile`、`composeContext()`、`Context Manifest` |
| 建议阶段 | **C2+**（与 Artifact / metrics 一并落地） |
| CS 类比 | cgroup / DB buffer pool 分账户 |

### 3.6 代价与优势

| 代价 | 优势 |
|------|------|
| Composer 与 metrics 更复杂 | system/tools 不被对话挤没 |
| 需定义各 tier 默认比例或 env 覆盖 | Manifest 可解释「哪一类超支」 |

---

## 4. 优先方向：Structured Session IR

### 4.1 问题

纯 prose summary 易漂移、难验证；coding agent 的 **文件 / tool / 任务态** 更适合结构化表示。

### 4.2 设计

**领域 IR**（非全 session 向量 graph）：

| 领域 | IR 形态 | 存储 |
|------|---------|------|
| **Files** | path tree、`fileAnchors`、可选 mtime/hash | Compaction Record `StructuredPayload` |
| **Tool** | typed outcome（name、exit、bytes、toolUseId） | Session Event Log + Artifact metadata |
| **Task** | `goals[]`、`decisions[]`、`openQuestions[]` | Compaction Record |

**对话：** 保持 Session Event Log **时序 + recent tail**；不做全 session 向量化或 knowledge graph（第一版 **非目标**）。

与 [`context-composer.md` §6.3](../../spec/context-composer.md#63-compaction-record) `StructuredPayload` 对齐；summary 类 Compaction 优先写 IR，再 **渲染** 为模型可见文本。

### 4.3 依赖与阶段

| 项 | 说明 |
|----|------|
| 依赖 | C1 Session Event Log、C4 Compaction Record |
| 建议阶段 | **C4**（与 `/compact summary` 迁移同批） |
| CS 类比 | 编译器 IR（源码 = Event Log，IR = Compaction Record） |

### 4.4 代价与优势

| 代价 | 优势 |
|------|------|
| schema 演进与渲染模板 | summary 稳定、可 diff、可部分更新 |
| 不对话做 embedding 索引 | 范围克制、可实现 |

---

## 5. Experiment：Priority Placement（编排）

### 5.1 问题

在分账保证配额后，仍可通过 **物理位置** 影响模型对关键信息的利用（primacy / recency；避免 lost-in-the-middle）。

### 5.2 设计

Compose 时的 **可选实验策略**：

- L1 内容优先进入 `system` **前部**（稳定 prefix，利于 cache）
- L2 recent tail 固定在 `messages` **末尾**
- L3 `ToolResultSummary` 紧贴相关 tool turn，避免远距离 orphan

**Feature flag（示意）：** `MOONTIDE_COMPOSE_PLACEMENT_EXPERIMENT=1`

与 Budget Tiers **配合**；优先级 **标签** 弱于 placement，仅作 debug。

### 5.3 依赖与阶段

| 项 | 说明 |
|----|------|
| 依赖 | C1 Composer 骨架 |
| 建议阶段 | 任意（不阻塞 C1）；A/B 对比 task 成功率 |
| 性质 | **Experiment**，非 Spec 硬要求 |

---

## 6. Backlog：Intent-scoped Working Set

### 6.1 问题

仅保留「最近 N 轮」时，长 session 中 **与当前 intent 相关但较旧** 的事实可能被 tail 策略丢弃。

### 6.2 设计

从 **Session Event Log** 选取与当前 user 意图相关的条目，作为 **L2 Dialogue 账内** 的补充 slot（不占用 L4 Reserved 本体）：

- 事实源仍是 Event Log（非独立 memory 黑盒）
- **约束：** `tool_use` / `tool_result` 不可拆对；条目顺序单调；总 token ≤ L2 预算
- 选取理由写入 `ContextManifest.excludedEntryIds` / `includedEntryIds`

类似产品中的 **情景 / working memory**；MoonTide 差异在于 **可审计、可复现**（Manifest + log id）。

**Feature 名（示意）：** `intentWorkingSet`

### 6.3 依赖与阶段

| 项 | 说明 |
|----|------|
| 依赖 | C1 Event Log、C2+ Budget Tiers；可选 Structured IR 锚点 |
| 建议阶段 | **C5+** 或独立 backlog |
| 检索 v1 | path / keyword / 同 turn 锚点（不必 embedding） |

### 6.4 代价与优势

| 代价 | 优势 |
|------|------|
| 检索错误 → silent 丢上下文 | 长 session 质量优于纯 tail |
| 实现与测试矩阵 | 与 Event Log 单一事实源一致 |

---

## 7. Backlog：Compose-time Dedup（CDC / 引用）

### 7.1 问题

同一文件多次 `read_file`、同一结论多次写入 messages，造成 **重复 inline token**。

### 7.2 设计

| 手段 | 说明 |
|------|------|
| **Artifact + ToolResultSummary** | 全文在 Artifact Store；compose 默认只含 `ToolResultSummary` |
| **Content hash（CDC）** | `hash(content) → artifactId`；相同内容 **共用** 一份存储与引用 |
| **Compose 块去重** | 同一 turn compose 输入合并 identical `ContentBlock` |
| **IR 引用** | 对话中「见 Compaction Record `<id>`」而非重复结构化事实 |

**CDC ≠ CPU L1 cache：** CDC 是 **内容相同只存一份**；recent working set（热 tail）是 **时间局部性**，二者可并用。

### 7.3 依赖与阶段

| 项 | 说明 |
|----|------|
| 依赖 | C2 Artifact Store |
| 建议阶段 | C2 基础 `ToolResultSummary`；**C3+** content hash |
| CS 类比 | 内容寻址存储（rsync block identity） |

### 7.4 代价与优势

| 代价 | 优势 |
|------|------|
| hash 与 metadata 维护 | 显著降低重复 read 的 token |
| 同 path 不同 content 需新 Artifact | 磁盘与 context 双省 |

---

## 8. Backlog：Agent Activity Model（认知动作 / 广度阶梯）

> **来源：** 对照 [Cursor](https://cursor.com) 终端 activity 展示（read · grepped · explored · thought）的讨论（2026-08）。  
> **Roadmap 入口：** [`context-window-roadmap.md` §7](context-window-roadmap.md#7-agent-活动模型cursor-对照--backlog) · 背景见 [`context-analysis.md`](context-analysis.md)（subagent / fresh context）。

### 8.1 问题

终端与 Event Log 若只暴露 **tool 名**（`read_file`、`grep`），用户难以感知 agent 在 **精读 / 检索 / 探索 / 推理** 哪一档。Cursor 的产品化启示是 **观测分层**：展示认知动作，debug 仍保留原始 tool。

MoonTide 现状：

| 能力 | 状态 |
|------|------|
| `reason.think` | **已有** — `thinking` trace kind 与 tool 分离（`format-trace.ts`） |
| `gather.read` / `gather.search` | **工具已有** — workspace I/O + `grep`；缺语义 activity 映射 |
| `gather.explore` | **缺口** — 无一等公民「隔离子 run + bounded 回传」；`deep_research` ≠ explore |
| `act.shell` / `act.edit` | 映射到 bash / edit 类 builtin，未统一 activity 标签 |

### 8.2 设计（三条，不必抄 Cursor 命名）

**1. 工具 registry 与 activity class 解耦**

- **Registry** 保持实现名：`read_file`、`grep`、`bash`、`edit`…
- **观测层** 叠加 taxonomy（示意）：

```text
gather.read | gather.search | gather.explore | act.shell | act.edit | reason.think
```

- 映射表：`tool name (+ optional input heuristic) → activity class`
- 落点：Agent Event `channel`/`kind` 之上或 parallel 字段；statusline / `/thinking` i18n；**不改** hook phase 与 tool schema

**2. Agent 指令写清「广度阶梯」**

在 Instruction State（`AGENTS.md` / rules）约定 workflow，**不必新工具**：

```text
read（定点） → grep（搜针） → explore（扫库） → act（改/跑）
                      ↑
              reason.think（选路，发生在工具之间）
```

| 情境 | 优先动作 |
|------|----------|
| 已知文件路径 | `gather.read` |
| 已知符号 / 字符串 | `gather.search` |
| 不知从哪找 | 并行 read/grep，或（将来）explore |
| 大段 tool 输出 | spill + `read_artifact`（C2 / Budget L3） |

减少 `bash find | xargs cat` 替代 grep 等反模式。

**3. Explore MVP — 不必先做完整 subagent**

| 阶段 | 形态 |
|------|------|
| **MVP** | 单次 run 内 **并行 tool batch**（现有 loop + prompt 约束）；或 sidecar：固定 explore prompt + 独立 runId + **仅回传摘要** |
| **远期** | fork/fresh subagent（parent 只收 bounded result）；与 Claude Code subagent、[`session-handoff.md`](../session/session-handoff.md) 对齐 |

**明确非目标：**

- 不为对齐 UI 新增 `explored` / `thought` **假 tool**
- explore ≠ `deep_research`（广搜 vs 长链路研究）

### 8.3 依赖与阶段

| 项 | 说明 |
|----|------|
| 依赖 | C6 Agent Event · instruction-state ·（可选）sidecar plugin |
| 建议阶段 | **7a/7b** 可独立（映射表 + AGENTS 文案）；**7c** 依赖 agent loop 并行或 sidecar |
| 性质 | **Backlog**；不阻塞 Context Composer correctness |

### 8.4 代价与优势

| 代价 | 优势 |
|------|------|
| tool → activity 映射维护 | 终端可读性与 debug 语义一致 |
| explore 编排复杂度 | 补齐 Cursor 式「扫库」档，控制 context 爆炸 |
| 与 i18n activity 字符串协同 | 不绑定英文动词；中英可分别本地化 |

**讨论备忘（待续）：** [`agent-activity-model-discussion.md`](agent-activity-model-discussion.md) — 7a–7c 细节、开放问题 checklist、代码锚点。

---

## 9. Deferred：Compaction Invariants（验证）

### 9.1 说明

**当前共识：不纳入第一版验收。** 此处备查定义，避免与「分账 / 触发条件」混淆。

| | **When（触发）** | **Validate（验证）** |
|---|------------------|----------------------|
| 关注点 | 何时执行 Compaction | Compaction **之后** compose 产出是否仍合法 |
| 第一版 | token 压力 / 阈值（沿用 compaction policy 思路） | **不做** |
| 远期示例 | 分级压力 | instruction 已注入；tool 配对完整；tier 未越界；失败 → mechanical fallback |

Validate 的新意是 **状态转换正确性**（类似 DB constraint），不是替换百分比触发。

---

## 10. 明确非目标（讨论共识）

| 非目标 | 说明 |
|--------|------|
| 全 session **对话**向量化 / knowledge graph | 理论阶段；第一版不做 |
| 后台并行 compaction daemon | 见 context-analysis research frontier |
| Vector **跨 session** memory | 远期；不阻塞 C0–C6 |
| Cherry 式大 context 聚合 UI | 非 MoonTide harness 范围 |

---

## 11. CS 历史借鉴（简表）

| 历史实践 | MoonTide 映射 |
|----------|--------------|
| 虚拟内存 / working set | Session Event Log + Composer 编译 |
| WAL + snapshot | Checkpoint + immutable `LLMRequest` |
| 日志结构存储 + segment GC | append-only log；Compaction 整理 **compose 规则** |
| 编译 IR | Structured Compaction Record |
| 内容寻址 | Artifact CDC |
| cgroup 分账 | Context Budget Tiers L1–L4 |

详述见 [`context-analysis.md`](context-analysis.md)。

---

## 12. 特性 × 实现阶段矩阵

与 [`context-composer.md` §12](../../spec/context-composer.md#12-后续实现分期代码指引) C0–C6 对齐：

| 特性 | 级别 | 建议阶段 | 阻塞于 |
|------|------|----------|--------|
| Context Budget Tiers | Core | C2+ | C1 Composer |
| Structured Session IR | 优先 | C4 | C1 Event Log |
| Priority Placement | Experiment | 任意 | C1 |
| Intent-scoped Working Set | Backlog | C5+ | C1；可选 IR |
| Episodic memory（L0–L3） | Backlog | C5+ | Session Log；见 edge-local-models |
| Compose Dedup / CDC | Backlog | C2–C3+ | C2 Artifact |
| Prompt Prefix Cache | Backlog | C2+ · **§8.1 后续轨** | Stable Composer prefix；provider usage |
| Conversation Normalization | Backlog | C2+ · **§8.4 后续轨** | Preflight / Postflight；见 context-normalization |
| Local Fusion | Backlog | C0+ · **§8.3 后续轨** | edge-local-models · Model Router |
| Agent Activity Model | Backlog | C6+ | C6 Agent Event；instruction-state；见 §8 |
| Compaction Invariants | Deferred | — | — |

**主路径：** C0 Provider A–C **done** → C1 Event Log + Composer + prune → C2 Artifact → C3 Instruction → C4 Compaction Record → C5 Checkpoint → C6 双 log 同步。

---

## 13. 相关文档

| 文档 | 关系 |
|------|------|
| [`context-composer.md`](../../spec/context-composer.md) | 主 Spec 与 C0–C6 |
| [`llm-provider.md`](../../spec/llm-provider.md) | `LLMRequest`、`ModelProfile` |
| [`llm-input.md`](../../spec/llm-input.md) | 三参数对表 |
| [`context-analysis.md`](context-analysis.md) | 竞品与 SOTA |
| [`agent-activity-model-discussion.md`](agent-activity-model-discussion.md) | §8 讨论备忘 · 7a–7c checklist |
| [`web-content-retrieval-discussion.md`](web-content-retrieval-discussion.md) | 外网/HTML/artifact 阅读 · W1–W7 backlog（讨论备忘） |
| [`agent-eval-roadmap.md`](../evals/agent-eval-roadmap.md) | Feature 评测流水线 · D 桶 infra_penalty · TODO §7/§8 |
| [`agent-events.md`](../../spec/agent-events.md) | Agent Event Log |
| [`vision.md`](../../product/vision.md) | Bruma 代号 |
| [`AGENTS.md`](../../../AGENTS.md) | 文档用词 |
| [`session-handoff.md`](../session/session-handoff.md) | 跨 agent 交接与 memory 指针 |
| [`edge-local-models.md`](../llm/edge-local-models.md) | 情景 memory L2–L3、local extract |
| [`kocoro-architecture.md`](../runtime/kocoro-architecture.md) | memory bundle pull、ephemeral inject |

---

## 14. 一句话

**分账（L1–L4）保证各块 token 互不占；Structured IR 优先结构化文件/task；Placement / Intent WS / Dedup 为实验或 backlog；Compaction 验证暂缓。**

---

## 15. Backlog：Prompt Prefix Cache

> **后续计划轨 8.1：** [`context-window-roadmap.md`](context-window-roadmap.md) §8.1 · [`TODO.md`](../../../TODO.md) §15.1

### 15.1 目标

在连续多轮 request 中复用稳定的 system / instruction / tool-definition prefix，降低 provider latency、input cost 和重复 token processing。

这是性能优化，不是 correctness boundary：即使 cache miss 或 provider 不支持 cache，最终 `LLMRequest` 仍必须独立正确执行。

### 15.2 可缓存 prefix

推荐将 request 编排成：

```text
Stable Prefix
  ├─ model/provider-compatible system instructions
  ├─ stable project rules / instruction state
  ├─ deterministically ordered tool definitions
  └─ explicitly versioned stable capability descriptions

Dynamic Suffix
  ├─ working-set snapshot
  ├─ compaction record / summary projection
  ├─ conversation messages
  └─ current user prompt and tool results
```

不是所有“较旧内容”都应该进入 prefix。Working Set、Compaction Record 和 tools 只有在 revision、schema 和排序稳定时，才可以成为 prefix 的一部分；否则应放在 dynamic suffix。

### 15.3 Cache identity 与失效条件

Prefix fingerprint 至少应覆盖：

| 输入 | 说明 |
|------|------|
| provider / route | 不同 provider 或 route 不共享假定的 prefix |
| model profile | model、context window、thinking 能力变化时失效 |
| instruction epoch | `AGENTS.md`、rules 或基础 system prompt 变化时失效 |
| ordered tool schema hash | tool 名称、description、input schema 或顺序变化时失效 |
| capability/plugin revision | 插件描述或能力集合变化时失效 |
| working-set / compaction revision | 只有被明确放入 stable prefix 时才纳入 |

`sessionId` 不应被无条件放入内容 fingerprint；是否按 Session 隔离由 provider cache contract 和隐私策略决定。

以下情况必须造成 cache miss 或新的 prefix fingerprint：

- system / instruction state 变化；
- tool definition、tool 顺序或 schema 变化；
- model、provider route、thinking 配置变化；
- prefix 中的 working-set / compaction revision 变化；
- prefix 排序策略变化；
- provider 明确报告 cache 不可用或失效。

### 15.4 Composer / Provider 边界

Context Composer 负责生成稳定、可解释的 prefix，并在 `ContextManifest` 中记录：

```ts
interface PromptPrefixInfo {
  fingerprint: string;
  tokenEstimate: number;
  cacheEligible: boolean;
  invalidationReason?: string;
}
```

Provider adapter 负责将该信息映射为 provider-specific cache controls 或读取 provider 返回的 cache usage。Core 不应假设所有 provider 都支持显式 cache breakpoint。

如果 provider 只支持 exact-prefix automatic caching，Composer 应保证稳定排序和 append-friendly request layout；如果 provider 支持显式 breakpoint，再由 adapter 负责映射。

### 15.5 与 Compaction / Normalization 的关系

Preflight 顺序建议为：

```text
build instruction + tools
  → choose stable prefix
  → apply compaction / budget normalization
  → compute prefix fingerprint
  → build final LLMRequest
```

Compaction 不得为了追求 cache hit 而保留已经超出预算的内容。正确性与预算优先，cache 只在合法 projection 上优化。

如果 compaction 改变了 system、tool schema、summary 或 prefix ordering，应显式记录 cache invalidation，而不是报告一个虚假的 cache hit。

### 15.6 实现阶段

| 阶段 | 内容 |
|------|------|
| P0 Observe | 计算 prefix fingerprint、prefix token estimate 和潜在 cache break reason，不改变 provider 行为 |
| P1 Stable Layout | 固定 system / tools 排序，拆分 stable prefix 与 dynamic suffix，写入 ContextManifest |
| P2 Provider Adapter | 读取 provider cache usage，支持显式 cache controls；不支持时安全降级 |
| P3 Request Reuse | 仅在 provider contract 明确支持、model/config/prefix 完全一致且 suffix 是 append-compatible 时复用 |

### 15.7 验收标准

- 同一 provider、model、instruction epoch、tool schema 和 prefix 内容生成相同 fingerprint；
- 任一稳定 prefix 输入变化都会产生新的 fingerprint；
- cache miss 不影响 request correctness；
- provider 不支持 prefix cache 时正常运行；
- compaction 不会造成错误 cache hit；
- manifest 能区分 `cacheEligible`、`cacheHit`、`cacheMiss` 和 `cacheBreakReason`；
- provider 返回的 cache usage 与本地 fingerprint 观测可以对照；
- cache 机制不持久化完整 prompt 或 secret，除非 provider contract 和隐私策略明确允许；
- benchmark 能测量 cache hit rate、input cost、latency 和 compaction 后的恢复行为。

### 15.8 非目标

- 不实现完整 response cache；
- 不把 cache hit 当成 correctness 或 context recovery 的证明；
- 不为了 cache 保留过时的 instruction、tool schema 或 compaction 内容；
- 不在 provider contract 不明确时复用跨 Session 的 prompt 内容；
- 不先实现复杂的本地 cache daemon。
