# Doc Map

MoonTide 文档分三层：`product/` 定方向，`spec/` 是可实现的设计，`notes/` 是分析与候选。用词规范见 [`agent.md`](../agent.md)。**执行优先级**见根 [`TODO.md`](../TODO.md)（§15 后续四条轨）。

**模块级操作说明（与 Doc Map 并列，避免孤儿文档）：**

| 路径 | 内容 |
|------|------|
| [`src/tools/builtins/README.md`](../src/tools/builtins/README.md) | 内置 tool 目录约定、域一览、新增 checklist |
| [`src/plugins/builtin/README.md`](../src/plugins/builtin/README.md) | 内置 plugin 模块、含 tool 的 spec/impl 约定 |

**命名：** 全部小写 kebab-case；`{domain}-{topic}.md`，目录已表达层级时不重复前缀。

```mermaid
flowchart TB
  subgraph product["product/"]
    V[vision]
    P[plan]
    PS[platform-strategy]
  end

  subgraph spec["spec/"]
    CC[context-composer]
    LP[llm-provider]
    LI[llm-input]
    AE[agent-events]
  end

  subgraph notes["notes/"]
    CWR[context-window-roadmap]
    AR[agent-run-hooks]
    UI[utils-infrastructure]
    EC[ecosystem-compat]
    CA[context-analysis]
    CB[context-backlog]
    AAM[agent-activity-model-discussion]
    CN[context-normalization]
    SDM[session-domain-model]
    SLM[session-log-migration]
    EL[edge-local-models]
    KO[kocoro-architecture]
    SH[session-handoff]
    RM[runtime-multilang]
    PH[plugin-host]
    SP[scratchpad]
    AFP[architecture-remediation]
  end

  V --> CC
  V --> PS
  PS --> RM
  PS --> AR
  AR --> EC
  PH --> EC
  PS --> PH
  PH --> RM
  PH -.-> AE
  P --> AE
  AR -.-> AE
  CWR --> UI
  CWR --> CC
  CWR --> AR
  SDM --> CC
  AFP --> CC
  AFP --> SDM
  CWR --> AFP
  SLM --> CWR
  CC --> LP
  CC --> LI
  LP --> LI
  CA --> CC
  CB --> CC
  AAM --> CB
  AAM --> CWR
  CWR --> CN
  CN --> CC
  CWR --> EL
  EL --> LP
  KO --> RM
  KO --> EL
  SH --> CC
  RM -.-> CC
  SP -.-> CC
```

## 目录

| 目录 | 性质 | 文档 |
|------|------|------|
| [`product/`](product/) | 方向 | [vision](product/vision.md) · [plan](product/plan.md) · [platform-strategy](product/platform-strategy.md) |
| [`spec/`](spec/) | 设计 Spec | [context-composer](spec/context-composer.md) · [llm-provider](spec/llm-provider.md) · [llm-input](spec/llm-input.md) · [agent-events](spec/agent-events.md) |
| [`notes/`](notes/) | 参考 / 候选 | [context-window-roadmap](notes/context-window-roadmap.md) · [architecture-remediation](notes/architecture-remediation.md) · [deep-mode](notes/deep-mode.md) · [session-domain-model](notes/session-domain-model.md) · [session-log-migration](notes/session-log-migration.md) · [session-persistence](notes/session-persistence.md) · [context-inspect-debug](notes/context-inspect-debug.md) · [agent-run-hooks](notes/agent-run-hooks.md) · [utils-infrastructure](notes/utils-infrastructure.md) · [ecosystem-compat](notes/ecosystem-compat.md) · [context-analysis](notes/context-analysis.md) · [context-backlog](notes/context-backlog.md) · [agent-activity-model-discussion](notes/agent-activity-model-discussion.md) · [context-normalization](notes/context-normalization.md) · [edge-local-models](notes/edge-local-models.md) · [kocoro-architecture](notes/kocoro-architecture.md) · [plugin-host](notes/plugin-host.md) · [session-handoff](notes/session-handoff.md) · [runtime-multilang](notes/runtime-multilang.md) · [scratchpad](notes/scratchpad.md) |

## 阅读路径

**新人** — vision → plan → context-composer → llm-provider → llm-input

**改 agent hook / 观测** — agent-run-hooks（phase · sidecar dispatch）→ ecosystem-compat（MCP/Codex 兼容）→ agent-events（Spec）

**改模块边界 / 架构修复** — [agent.md](../agent.md) §2 → [architecture-remediation](notes/architecture-remediation.md) → [context-composer](spec/context-composer.md) §4/§10.1 → [session-domain-model](notes/session-domain-model.md)

**新增 / 修改 builtin tool** — [agent.md §2.1](../agent.md#21-声明与实现分离spec--impl-split) → [tools/builtins/README](../src/tools/builtins/README.md) → [register-defaults.ts](../src/tools/register-defaults.ts) · `pnpm test:conformance`

**新增 / 修改 plugin tool**（code_repl、deep_research、work_mem）— [plugins/builtin/README](../src/plugins/builtin/README.md) → [deep-mode](notes/deep-mode.md)（`work_mem`）→ 同上 conformance

**接 MCP / 外部 Plugin** — ecosystem-compat → plugin-host → platform-strategy

**改 context** — [context-window-roadmap](notes/context-window-roadmap.md)（**#1–#6 + Budget Tiers done · §8 后续四条轨**）→ [session-domain-model](notes/session-domain-model.md)（类型/数据流）→ context-composer（主 Spec）→ agent-run-hooks（Session/Turn Observe）→ [utils-infrastructure](notes/utils-infrastructure.md) → context-backlog（C6+ 演进）→ context-analysis（行业背景）

**后续四条轨（2026-08）** — [TODO.md](../TODO.md) §15 → [context-window-roadmap](notes/context-window-roadmap.md) §8 → 分轨：[context-backlog §15 Prefix Cache](notes/context-backlog.md) · [agent-activity-model-discussion](notes/agent-activity-model-discussion.md) · [edge-local-models Local Fusion](notes/edge-local-models.md) · [context-normalization](notes/context-normalization.md)

**改 context preflight / postflight** — [context-normalization](notes/context-normalization.md)（本 feature backlog）→ context-composer（最终 request owner）→ agent-run-hooks（完整 turn postflight）

**改 REPL session 持久化** — [session-persistence](notes/session-persistence.md) → session-domain-model → context-composer §4

**改 context 调试 dump** — [context-inspect-debug](notes/context-inspect-debug.md) → README §CLI（Debug）

**跨 agent 交接** — session-handoff（产品讨论）→ context-composer（Session Log / Composer）→ vision（Zephyr 远期）

**改 LLM 接入** — llm-provider → llm-input → agent-events（run 观测字段）

**Edge 本地模型 / Local Fusion** — [edge-local-models](notes/edge-local-models.md)（§2.1 Local Fusion）→ [llm-provider](spec/llm-provider.md) Model Router → [runtime-multilang](notes/runtime-multilang.md) · [context-window-roadmap](notes/context-window-roadmap.md) §8.3

**改桌面 runtime** — runtime-multilang → kocoro-architecture → context-composer

**Release / 竞争定位** — platform-strategy → plugin-host → runtime-multilang → context-analysis

**Hook 工程落地** — agent-run-hooks §11+ → agent-run-hooks §1–§10 → [agent-run.ts](../src/agent/agent-run.ts)

**Rust REPL 开发** — 根 [README](../README.md) §Rust CLI → `crates/moontide-cli` · `crates/moontide-observability` · `platform-strategy` §10

## notes 主题索引

| 主题 | 主文档 | 关联 |
|------|--------|------|
| Agent hook 设计 | [agent-run-hooks](notes/agent-run-hooks.md) | agent-events · session-log-migration · platform-strategy |
| Release 与平台策略 | [platform-strategy](product/platform-strategy.md) | plugin-host · runtime-multilang · kocoro-architecture · agent-run-hooks |
| 插件与 MCP 集成 | [plugin-host](notes/plugin-host.md) | platform-strategy · runtime-multilang · scratchpad |
| Deep Task Mode / work_mem | [deep-mode](notes/deep-mode.md) | work-mem plugin · compose Working Set |
| 架构修复计划 | [architecture-remediation](notes/architecture-remediation.md) | Phase A–C；六件事 done 后择项 |
| Agent Activity Model | [agent-activity-model-discussion](notes/agent-activity-model-discussion.md) | context-backlog §8 · roadmap §7 · TODO §15.2 |
| Utils / storage 分层 | [utils-infrastructure](notes/utils-infrastructure.md) | fs · process · event-hub · storage |
| Builtin / plugin tool 结构 | [tools/builtins/README](../src/tools/builtins/README.md) · [plugins/builtin/README](../src/plugins/builtin/README.md) | agent.md §2.1 · register-defaults · architecture-boundaries |
| Session 域模型 | [session-domain-model](notes/session-domain-model.md) | SessionContext / Item / compose 数据流 |
| Session 迁移 | [session-log-migration](notes/session-log-migration.md) | C1a/C1b；链到 #1 runtime-status |
| Session 书签 / 恢复 | [session-persistence](notes/session-persistence.md) | `/save` · `/resume session` · index.json |
| Context debug dump | [context-inspect-debug](notes/context-inspect-debug.md) | `/debug` · context-inspect |
| Context 演进 / 后续计划 | [context-window-roadmap](notes/context-window-roadmap.md) §8 · [TODO.md](../TODO.md) §15 | context-backlog · context-normalization · edge-local-models |
| Prompt Prefix Cache | [context-backlog](notes/context-backlog.md) §15 | context-normalization §13 · context-composer |
| Local Fusion（edge 路由） | [edge-local-models](notes/edge-local-models.md) §2.1 | llm-provider · runtime-multilang · TODO §15.3 |
| Context Preflight / Postflight | [context-normalization](notes/context-normalization.md) | context-composer · agent-run-hooks · deep-mode |
| 跨 agent 交接 | [session-handoff](notes/session-handoff.md) | context-composer · vision（Zephyr） |
| Edge 本地推理 / catalog | [edge-local-models](notes/edge-local-models.md) | Local Fusion §2.1 · llm-provider · runtime-multilang |
| 多语言 Runtime | [runtime-multilang](notes/runtime-multilang.md) | kocoro-architecture · edge-local-models |
| 参考架构 | [kocoro-architecture](notes/kocoro-architecture.md) | edge-local-models · runtime-multilang |
| 草稿执行 | [scratchpad](notes/scratchpad.md) | runtime-multilang §4.4 WASM |

## 文档速查

| 文档 | 一句话 |
|------|--------|
| [vision](product/vision.md) | 产品定位（MoonTide）与远期保留产品名（Bruma 等） |
| [platform-strategy](product/platform-strategy.md) | Release 架构、竞争定位、MCP/sidecar 边界与非目标 |
| [plugin-host](notes/plugin-host.md) | Plugin host、MCP client、startup assembly 与 runtime attach |
| [plan](product/plan.md) | 当前优先级、分段 JSONL 存储与非目标 |
| [context-composer](spec/context-composer.md) | Session Event Log、Context Composer、Compaction 主 Spec |
| [llm-provider](spec/llm-provider.md) | Provider preset、`local-direct`、API 适配层、`LLMRequest` |
| [llm-input](spec/llm-input.md) | 一次调用的 `system` / `tools` / `messages` 对表 |
| [agent-events](spec/agent-events.md) | Agent Event Log（run 级 JSONL）schema |
| [agent-run-hooks](notes/agent-run-hooks.md) | Agent 运行时 hook：生命周期、四类语义、注册实践与 §11+ 工程落地 |
| [context-analysis](notes/context-analysis.md) | 竞品 context window 架构对比 |
| [deep-mode](notes/deep-mode.md) | Deep Task Mode：`deep:` prompt gate、`work_mem`、Working Set snapshot |
| [context-window-roadmap](notes/context-window-roadmap.md) | **开发计划**：六件事 done · §8 后续四条轨（Prefix Cache / 需求讨论 / Local Fusion / Normalization） |
| [architecture-remediation](notes/architecture-remediation.md) | **架构修复计划**：16 项 review · Phase A–C |
| [utils-infrastructure](notes/utils-infrastructure.md) | Utils / storage 分层、event-hub、import 约束 |
| [session-domain-model](notes/session-domain-model.md) | Session 类型、模块职责与 compose 数据流 |
| [session-log-migration](notes/session-log-migration.md) | C1 双写 → compose 迁移策略 |
| [session-persistence](notes/session-persistence.md) | Session Index 书签 · `/save` · `/resume session` |
| [context-inspect-debug](notes/context-inspect-debug.md) | `/debug` 分级全量 compose/llm/tool dump |
| [context-backlog](notes/context-backlog.md) | Context 演进特性候选（C6+ · §15 Prefix Cache 等） |
| [agent-activity-model-discussion](notes/agent-activity-model-discussion.md) | Agent Activity Model 讨论备忘：7a–7c、开放问题 checklist |
| [context-normalization](notes/context-normalization.md) | Preflight / Postflight Normalization（§8.4 后续轨） |
| [edge-local-models](notes/edge-local-models.md) | Local Fusion：edge 小模型 catalog + 路由降 cloud 成本 |
| [kocoro-architecture](notes/kocoro-architecture.md) | Kocoro/Shannon 架构参考与 MoonTide 对照 |
| [session-handoff](notes/session-handoff.md) | 跨 agent 会话交接：价值、分层方案、业界 gap |
| [runtime-multilang](notes/runtime-multilang.md) | 多语言 Desktop Runtime、`moontide-infer` sidecar |
| [scratchpad](notes/scratchpad.md) | `scratch.eval` 低风险草稿执行层 |

## 重命名对照

| 旧文件名 | 新文件名 |
|----------|----------|
| `VISION.md` | `product/vision.md` |
| `PLAN.md` | `product/plan.md` |
| `EVENTS.md` | `spec/agent-events.md` |
| `llm-input-mapping.md` | `spec/llm-input.md` |
| `context-window-analysis.md` | `notes/context-analysis.md` |
| `context-features-backlog.md` | `notes/context-backlog.md` |
| `multi-language-runtime.md` | `notes/runtime-multilang.md` |
| `executable-scratchpad.md` | `notes/scratchpad.md` |
