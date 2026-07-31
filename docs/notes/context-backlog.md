# Ocula Context Window 特性 Backlog

> Context Composer **演进特性**候选：优先级、设计要点、代价与阶段。  
> **非实现承诺** — 选型与排期以 [`context-composer.md`](../spec/context-composer.md) 主路径（C0–C6）为准。

---

## 1. 目的与阅读顺序

| 顺序 | 文档 | 内容 |
|------|------|------|
| 1 | [`context-composer.md`](../spec/context-composer.md) | 已定 Spec：Session Event Log、State Stores、Composer、Compaction / Checkpoint |
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

### 3.1 问题

单一 context 上限 + 全局 `percentUsed` 阈值时，**长对话或大 tool_result 会挤占** Instruction State、Tool Definitions 与输出预留，导致 system/tools 被 silent 压缩或截断。

### 3.2 设计

为 `LLMRequest` 各组成部分划定 **独立 token budget**（multi-ledger budgeting）：

| Tier | 名称 | 内容 | 策略 |
|------|------|------|------|
| **L1 Pinned** | 固定指令与工具 schema | Instruction State + Tool Definitions + 活跃 Compaction Record（若有） | **不参与** Compaction 压缩；超支时压 L2 或报错 |
| **L2 Dialogue** | 对话投影 | `messages` 中 user / assistant / tool 可见部分 | prune / tail_window / summary |
| **L3 Reference** | 外置引用 | Artifact receipt、短引用 | 全文 **never inline**；配额上限 |
| **L4 Reserved** | 输出预留 | 本轮 max output + thinking 头room | 从 `ModelCapabilities.contextWindow` **先扣减**，再分配 L1–L3 |

**Composer 填装顺序（概念）：**

```
C = ModelCapabilities.contextWindow
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
| 依赖 | `ModelCapabilities`、`composeContext()`、`Context Manifest` |
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

与 [`context-composer.md` §6.3](../spec/context-composer.md#63-compaction-record) `StructuredPayload` 对齐；summary 类 Compaction 优先写 IR，再 **渲染** 为模型可见文本。

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
- L3 receipt 紧贴相关 tool turn，避免远距离 orphan

**Feature flag（示意）：** `OCULA_COMPOSE_PLACEMENT_EXPERIMENT=1`

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

类似产品中的 **情景 / working memory**；Ocula 差异在于 **可审计、可复现**（Manifest + log id）。

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
| **Artifact + receipt** | 全文在 Artifact Store；投影只保留 receipt |
| **Content hash（CDC）** | `hash(content) → artifactId`；相同内容 **共用** 一份存储与引用 |
| **Compose 块去重** | 同一 turn 投影合并 identical `ContentBlock` |
| **IR 引用** | 对话中「见 Compaction Record `<id>`」而非重复结构化事实 |

**CDC ≠ CPU L1 cache：** CDC 是 **内容相同只存一份**；recent working set（热 tail）是 **时间局部性**，二者可并用。

### 7.3 依赖与阶段

| 项 | 说明 |
|----|------|
| 依赖 | C2 Artifact Store |
| 建议阶段 | C2 基础 receipt；**C3+** content hash |
| CS 类比 | 内容寻址存储（rsync block identity） |

### 7.4 代价与优势

| 代价 | 优势 |
|------|------|
| hash 与 metadata 维护 | 显著降低重复 read 的 token |
| 同 path 不同 content 需新 Artifact | 磁盘与 context 双省 |

---

## 8. Deferred：Compaction Invariants（验证）

### 8.1 说明

**当前共识：不纳入第一版验收。** 此处备查定义，避免与「分账 / 触发条件」混淆。

| | **When（触发）** | **Validate（验证）** |
|---|------------------|----------------------|
| 关注点 | 何时执行 Compaction | Compaction **之后** 投影是否仍合法 |
| 第一版 | token 压力 / 阈值（沿用 [`compact.ts`](../../src/context/compact.ts) 思路） | **不做** |
| 远期示例 | 分级压力 | instruction 已注入；tool 配对完整；tier 未越界；失败 → mechanical fallback |

Validate 的新意是 **状态转换正确性**（类似 DB constraint），不是替换百分比触发。

---

## 9. 明确非目标（讨论共识）

| 非目标 | 说明 |
|--------|------|
| 全 session **对话**向量化 / knowledge graph | 理论阶段；第一版不做 |
| 后台并行 compaction daemon | 见 context-analysis research frontier |
| Vector **跨 session** memory | 远期；不阻塞 C0–C6 |
| Cherry 式大 context 聚合 UI | 非 Ocula harness 范围 |

---

## 10. CS 历史借鉴（简表）

| 历史实践 | Ocula 映射 |
|----------|--------------|
| 虚拟内存 / working set | Session Event Log + Composer 投影 |
| WAL + snapshot | Checkpoint + immutable `LLMRequest` |
| 日志结构存储 + segment GC | append-only log；Compaction 整理 **投影** |
| 编译 IR | Structured Compaction Record |
| 内容寻址 | Artifact CDC |
| cgroup 分账 | Context Budget Tiers L1–L4 |

详述见 [`context-analysis.md`](context-analysis.md)。

---

## 11. 特性 × 实现阶段矩阵

与 [`context-composer.md` §12](../spec/context-composer.md#12-后续实现分期代码指引) C0–C6 对齐：

| 特性 | 级别 | 建议阶段 | 阻塞于 |
|------|------|----------|--------|
| Context Budget Tiers | Core | C2+ | C1 Composer |
| Structured Session IR | 优先 | C4 | C1 Event Log |
| Priority Placement | Experiment | 任意 | C1 |
| Intent-scoped Working Set | Backlog | C5+ | C1；可选 IR |
| Compose Dedup / CDC | Backlog | C2–C3+ | C2 Artifact |
| Compaction Invariants | Deferred | — | — |

**主路径不变：** C0 Provider A–C → C1 Event Log + Composer + prune → C2 Artifact → C3 Instruction → C4 Compaction Record → C5 Checkpoint → C6 双 log 同步。

---

## 12. 相关文档

| 文档 | 关系 |
|------|------|
| [`context-composer.md`](../spec/context-composer.md) | 主 Spec 与 C0–C6 |
| [`llm-provider.md`](../spec/llm-provider.md) | `LLMRequest`、`ModelCapabilities` |
| [`llm-input.md`](../spec/llm-input.md) | 三参数对表 |
| [`context-analysis.md`](context-analysis.md) | 竞品与 SOTA |
| [`agent-events.md`](../spec/agent-events.md) | Agent Event Log |
| [`vision.md`](../product/vision.md) | Bruma 代号 |
| [`agent.md`](../../agent.md) | 文档用词 |

---

## 13. 一句话

**分账（L1–L4）保证各块 token 互不占；Structured IR 优先结构化文件/task；Placement / Intent WS / Dedup 为实验或 backlog；Compaction 验证暂缓。**
