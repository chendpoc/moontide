
> **状态：** 设计草案 · **非实现承诺**  
> **动机：** 用户期望 `deep:` 触发「深度任务 + work_mem 结构化思考」；当前仅注册可选 tool，模型常跳过，且主 run 路径未注入 Working Set。  
> **关联：** [`deep-mode.md`](deep-mode.md) · [`context-composer.md`](../../spec/context-composer.md) · [`llm-provider.md`](../../spec/llm-provider.md) · [`agent-activity-model-discussion.md`](agent-activity-model-discussion.md)

---

## 1. 问题陈述

### 1.1 用户期望

输入 `deep: <goal>` 时，Agent 应：

1. 进入**可感知的深度任务态**（不是普通 chat 换皮）
2. **主动使用 `work_mem`** 维护 outline / hypothesis / decision，而非全靠对话历史
3. **Working Set 持续出现在 context**（L1 pinned），跨 turn / compaction 不丢任务脉络
4. （可选）在支持 extended thinking 的模型上**提高 reasoning 档位**

### 1.2 现状与缺口

| 能力 | 文档/测试声称 | 实际 REPL 主路径 |
|------|---------------|------------------|
| `deep:` gate + `work_mem` 注册 | ✅ | ✅ `repl/run.ts` → `tools.refresh()` |
| Working Set compose 注入 | ✅ `composeForSession` | ❌ **`AgentRun.buildInput` 直接调 `composeContext`**，未走 `composeForSession` |
| 模型必用 `work_mem` | 隐含 | ❌ 纯 optional tool，无 protocol / 无 harness 约束 |
| Deep 专用 system 指令 | 无 | ❌ 仅 generic AGENTS + 空 Working Set header |
| `thinkingLevel` 提升 | 无 | ❌ 与 `deep:` 无关，走 registry `defaultThinking` |
| 首 turn 自动 seed 任务态 | 无 | 仅写 `workmem_started` 事件，**无 outline 内容** |

**结论：** Deep Task Mode 目前是「能力开关」，不是「工作流」。测试覆盖的 compose 路径与生产 agent loop **分叉**，是 P0 缺陷。

---

## 2. 设计目标与非目标

### 2.1 目标

| # | 目标 |
|---|------|
| G1 | **单一 compose 入口**：所有 agent run（含 REPL）经 `composeForSession`，deep mode 下一致注入 Working Set + L1 分账 |
| G2 | **可执行的 Deep Task Protocol**：模型在 deep 任务中有明确、可观测的 `work_mem` 使用节奏 |
| G3 | **首 turn 即有任务态**：用户发 `deep:` 后第一轮 LLM 就能看到非空 Working Set（outline） |
| G4 | **深度 ≠ 假 tool**：仍用真实 `work_mem` + system 附录，不新增 `explored`/`thought` 类假 tool |
| G5 | **可观测**：trace / statusline / manifest 标记 `deepTaskActive` + `workMemId` |

### 2.2 非目标

- 不替代 `deep_research` plugin（长链路外研）
- 不强制无限 tool loop 或无限 turn
- 第一版不做 LLM 驱动的 `summarize`/`refine`（仍 deterministic pack）
- 不提供 `/deep` slash（保持 prompt gate）

---

## 3. 概念：三种「深度」

避免混称，设计里分开三条轨：

```text
┌─────────────────────────────────────────────────────────┐
│ A. Structured task memory（work_mem）  ← Deep Mode 核心   │
│    draft / note / decision → jsonl → Working Set       │
├─────────────────────────────────────────────────────────┤
│ B. Provider extended thinking（thinking blocks）         │
│    deep 模式下可选 bump thinkingLevel（模型支持时）      │
├─────────────────────────────────────────────────────────┤
│ C. Investigation breadth（gather 阶梯）                  │
│    与 Agent Activity Model 7b 正交；deep 不自动 explore  │
└─────────────────────────────────────────────────────────┘
```

本文 **G2–G3 聚焦 A**；B 为 P2 增强；C 不在 Deep Mode 内硬编码。

---

## 4. 目标架构

### 4.1 Compose 路径统一（P0）

```text
AgentRun.buildInput
  └─ composeForSession（替代直接 composeContext）
       ├─ resolveInstructionState
       ├─ if deep: resolveWorkingSetForCompose(workMemId)
       └─ composeContext(..., workingSetSnapshot)
```

**验收：** `tests/deep-mode-compose.test.ts` 场景改为对 **`AgentRun` / `continueReplAgent` 集成路径** 断言，而非仅直接调 `composeForSession`。

### 4.2 Deep Task 状态机

```text
                    deep: prompt
                         │
                         ▼
              ┌──────────────────┐
              │  DEEP_ACTIVE     │
              │  workMemId = wm_*│
              └────────┬─────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
   ORIENT (T0)   INVESTIGATE    SYNTHESIZE
   seed+outline   note+draft     decision
         │             │             │
         └─────────────┴─────────────┘
                       │
              follow-up / deep: new goal
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
   same workMemId              new workMemId
   (普通 follow-up)            (**每次 `deep:` 必新建任务**)
         │                           │
         ▼                           ▼
   /reset · new session         DEEP_OFF
```

| 阶段 | Harness 行为 | 模型期望 |
|------|--------------|----------|
| **ORIENT** | gate 后 **机械 seed** + system 附录 | 读 Working Set，补全/修正 outline，再 gather |
| **INVESTIGATE** | 正常 tool loop | 显著发现 → `work_mem note`（带 ref） |
| **SYNTHESIZE** | 检测到即将结束且无 `decision` 时，可选 **协议提醒轮** | `draft decision` + `draft action` 后再 final reply |

### 4.3 Deep System 附录（compose 注入）

在 `appendWorkingSetToSystem` **之前**插入固定 protocol 块（i18n 后续）：

```markdown
## Deep Task Mode (active)

- **Goal:** {goal from workmem_started}
- **Work memory:** `{workMemId}` — use tool `work_mem` for outline, notes, decisions.
- **Protocol:**
  1. Keep structured state in `work_mem` (not in chat prose).
  2. After meaningful reads/greps: `work_mem` action `note` with `ref` (path or toolUseId).
  3. Before delivering a conclusion: `work_mem` action `draft` kind `decision`.
  4. Do not store raw tool dumps in `work_mem`; reference artifacts/paths instead.
```

实现落点：`src/context/composer/deep-task-system.ts`（或 `agent/deep-task-prompt.ts`），由 `composeForSession` 在 `isDeepModeEnabled()` 时调用。

---

## 5. 核心机制：让 `work_mem` 真的被用起来

纯 prompt 不够；采用 **「机械 seed + 协议提醒 + 可选硬约束」** 三层：

> **术语：** 下文 **协议提醒（Protocol Reminder）** 指 harness 检测到 Deep Task Protocol 未满足时，**追加一条仅用于下一轮 LLM 的短消息**（提醒模型先写 `work_mem` 或补 `decision`）。不是新产品功能名，实现上可映射为带 `kind: protocol_reminder` 的 Session Item 或 compose 临时注入——见 §10.2。

### 5.1 机械 seed（P1，推荐必做）

在 `startDeepTask(sessionId, goal)` 内，写完 `workmem_started` 后 **立即追加**：

```text
work_mem draft kind=outline content=<deterministic template from goal>
```

模板示例（deterministic，不调 LLM）：

```markdown
# Task outline
Goal: {goal}

## Open questions
- (to be filled during investigation)

## Planned steps
- (to be filled)
```

**效果：** 首 turn compose 时 Working Set **非空**；模型看到的是「已有骨架待补全」，而非空白 optional tool。

### 5.2 首 turn 协议提醒（P1.5）

Deep system 附录 + 强化 `work_mem` tool description（仅 deep mode 下替换 description）：

> Deep Task Mode is **required** for this run. Start by refining the outline via `draft`, then investigate.

若首 turn assistant **无** `work_mem` 调用且已有其他 tool_use：在下一轮 compose 前插入 **一条协议提醒**（见 §10.2），例如：

```text
[Deep Task — protocol reminder] Before other tools, update the task outline with work_mem (action draft, kind outline).
```

Harness 最多追加 **1 次**协议提醒轮，避免死循环。

### 5.3 首 turn 硬约束（P2，可选）

仅当 provider adapter 支持 **tool_choice** / forced tool：

- Run turn 1 with `tool_choice: { name: "work_mem" }` 或等价
- 不支持则回退 5.1 + 5.2

MoonTide 第一版 **不依赖** 硬约束；以 seed + 协议提醒为主。

### 5.4 结束前 synthesize 协议提醒（P2）

在 `stopReason !== tool_use` 且 deep active 且 jsonl **无** `decision` draft 时（策略见 §10.4）：

- **不硬挡回复**；可选追加 **1 次** synthesize 协议提醒 → 再跑一轮 LLM
- 若仍无 `decision`，允许 return reply，manifest 记 `synthesizeSkipped: true`

---

## 6. Extended thinking 联动（P2）

| 条件 | 行为 |
|------|------|
| `isDeepModeEnabled()` && `modelProfile.supportsThinking` | `resolveRoute` 使用 `max(defaultThinking, "high")` |
| 用户 env 显式 `thinkingLevel` | 覆盖 deep bump |
| 不支持 thinking 的模型 | 跳过，仅 work_mem 路径 |

**注意：** thinking blocks 进 L2 对话分账；与 Working Set L1 独立。需在 manifest 记录 `deepMode: { thinkingBump: true }`。

---

## 7. 模块改动一览

| 模块 | 改动 |
|------|------|
| [`agent-run.ts`](../../../packages/agent/src/agent/agent-run.ts) | `buildInput` → `composeForSession` |
| [`deep-mode.ts`](../../../packages/agent/src/agent/deep-mode.ts) | seed outline；暴露 `getDeepTaskGoal(sessionId)` |
| [`compose-for-turn.ts`](../../../packages/agent/src/agent/compose-for-turn.ts) | 注入 deep system 附录 |
| [`working-set.ts`](../../../packages/context-composer/src/working-set.ts) | 或新模块：append deep protocol |
| [`work-mem/register.ts`](../../../packages/agent/src/plugins/builtin/work-mem/register.ts) | `startDeepTaskRecord` 调 seed helper |
| [`work-mem/tools.ts`](../../../packages/tools/src/extensions/work-mem/tools.ts) | deep 模式下强化 description |
| [`llm/routing/resolve.ts`](../../../packages/llm/src/routing/resolve.ts) | 可选 `resolveRoute({ deepMode })` |
| [`context/composer/types.ts`](../../../packages/context-composer/src/types.ts) | manifest 增加 `deepTask?: { workMemId, goal, stage }` |
| i18n | deep protocol 中英 |

---

## 8. 实现分期

| 阶段 | 内容 | 用户可感知 |
|------|------|------------|
| **P0** | AgentRun 统一 `composeForSession` | Working Set 在 REPL 真正进 system |
| **P1** | 机械 outline seed + deep system 附录 + tool 文案 | `deep:` 后 outline 可见，模型更常写 work_mem |
| **P1.5** | 首 turn 协议提醒 + manifest/trace `deepTaskActive` | 跳过 work_mem 时有纠正 |
| **P2** | thinkingLevel bump（默认 **high**）+ synthesize 协议提醒 | 更深推理 + 结论前尽量有 decision |
| **P3** | tool_choice 硬约束（按 provider 能力） | 首 turn 必调 work_mem |

**建议 PR 顺序：** P0 单独 PR（bugfix）→ P1 → P1.5 → P2。

---

## 9. 验收标准

### P0

- [x] REPL：`deep: foo` → 后续 turn compose 的 `system` 含 `## Working set`（有 seed 后含 outline）— **AgentRun → composeForSession**（2026-08）
- [x] `budgetTiers` pinned / `subAccounts.workingSet` 在 deep run manifest 中出现（经 composeForSession 路径）
- [x] 非 deep prompt：行为与现网一致（无 appendix、无 work_mem）

### P1

- [x] `workmem_started` 后 jsonl 含 `workmem_draft` outline，无需模型先调用（2026-08）
- [x] system 含 Deep Task Protocol 块 + goal（2026-08）

### P1.5

- [x] 首 turn 无 `work_mem` 时触发 **一次**协议提醒；仍无则不再拦截（2026-08）
- [x] manifest 记录 `deepTask.workMemId` + goal（2026-08）；Agent Event 经 RunEvent derive

### P2

- [x] deep + supportsThinking 模型：`thinkingLevel >= high`（除非 env 显式覆盖）（2026-08）
- [x] 无 `decision` 结束 run：触发 **最多一次** synthesize 协议提醒；仍无则允许回复并记 `synthesizeSkipped`（2026-08）

---

## 10. 已决事项（2026-08）

### 10.1 再次 `deep:` → **始终新建任务**

- 每次 `deep:` 生成新的 `workMemId` + 新 jsonl；**不提供** `deep:continue`。
- 同 session **普通 follow-up**（无 `deep:` 前缀）继续写 **当前 active** work-mem，deep mode 保持开启。

### 10.2 协议提醒（Protocol Reminder）是什么？

**定义：** Harness 在 agent loop 内向 context **追加的一条短指令**，用途是纠正「Deep Task Protocol 未执行」，例如首 turn 未调 `work_mem`、结束前未写 `decision`。

| 维度 | 约定 |
|------|------|
| 谁产生 | Harness（`AgentRun`），不是用户、不是模型 |
| 何时 | 下一轮 LLM 调用 **之前** inject 进 messages（或等价 compose 路径） |
| 用户可见性 | REPL **默认不展示**；`/debug` 与 Session Item Log **可审计** |
| 持久化 | **写入 Session Item Log**，`kind: protocol_reminder`（或 `meta.harnessKind`），便于 handoff / 复现 |
| 次数上限 | 每类提醒最多 **1 次**（orient / synthesize 分开计数） |

实现上类似「带标签的 system/developer 追加消息」，但 MoonTide 统一称为 **协议提醒**，避免口语化 *nudge*。

### 10.3 Thinking bump → **默认 `high`**

- Deep mode 且 `modelProfile.supportsThinking`：`thinkingLevel = max(registry.default, "high")`。
- 用户通过 env / 路由显式指定 thinking 时 **优先用户配置**。
- 不支持 thinking 的模型：跳过，仅走 work_mem 路径。

### 10.4 无 `decision` 能否直接回复？→ **软提醒，不硬挡**

**建议（已采纳）：**

| 策略 | 说明 |
|------|------|
| **默认** | 允许直接回复用户；manifest 记 `deepTask.synthesizeSkipped: true` |
| **可选一轮提醒** | 首次试图结束且无 `decision` 时，追加 **synthesize 协议提醒** → 再给模型 **1 次** turn 写 `work_mem draft/decision` |
| **仍无 decision** | 不再拦截，返回模型文本回复 |
| **不采用** | 无限重试、或硬挡「必须写 decision 才能结束」（易误伤「deep: 解释这段代码」等轻量任务） |

远期若需要严格模式，可加 `MOONTIDE_DEEP_REQUIRE_DECISION=1` opt-in，第一版不做。

### 10.5 仍待实现时拍板

- **L1 分账**：deep protocol 文本进 **instruction 稳定段**；Working Set snapshot 进 **workingSet 子账**（与 context-backlog §3 一致）。

---

## 11. 与路线图关系

| 文档 | 关系 |
|------|------|
| [`agent-activity-model-discussion.md`](agent-activity-model-discussion.md) | deep 不自动 explore；investigate 阶段仍走 7b 广度阶梯 |
| [`context-normalization.md`](context-normalization.md) | deep appendix 属 preflight stable prefix 候选（§8.1 Prefix Cache） |
| [`edge-local-models.md`](../llm/edge-local-models.md) | Local Fusion 路由 **不包含** deep 任务自动降级（coding/reasoning 留 cloud） |

---

## 12. 变更记录

| 日期 | 说明 |
|------|------|
| 2026-08 | 初稿：现状缺口、P0 compose 分叉、seed/protocol 方案 |
| 2026-08 | §10 已决：新任务、协议提醒术语、thinking high、synthesize 软提醒 |
| 2026-08 | **P0 done**：`AgentRun.buildInput` → `composeForSession` + `agent-run-deep-compose.test.ts` |
| 2026-08 | **P1 done**：outline seed · deep protocol · work_mem 强化描述 |
| 2026-08 | **P1.5 done**：orient 协议提醒 · manifest.deepTask · protocol_reminder SessionItem |
| 2026-08 | **P2 done**：thinking bump · synthesize 协议提醒 · synthesizeSkipped manifest |
