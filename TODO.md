# TODO

> 产品方向：[`docs/product/vision.md`](docs/product/vision.md) · 当前计划：[`docs/product/plan.md`](docs/product/plan.md) · 设计索引：[`docs/README.md`](docs/README.md)

- [ ] **16. Agent-core 内核（2026-08 起 · 优先于 §15 部分轨）**

  终局拆分 pnpm workspace：`@moontide/agent-common`（protocol）+ `@moontide/agent-core`（loop · RunEvent bus · resolveRunConfig · resolveTurnContext）。**clean break**，无 legacy derive / HookPhase 双轨。

  - 详计划：[`docs/notes/agent-core-roadmap.md`](docs/notes/agent-core-roadmap.md)
  - 设计 Spec：[`docs/agent-core-design.md`](docs/agent-core-design.md)
  - 术语：[`AGENTS.md`](AGENTS.md) §7.2

  - [x] **16.1** pnpm workspace + `agent-common/protocol` 类型冻结
  - [x] **16.2** `agent-core`：RunEvent bus + lifecycle + golden tests
  - [x] **16.3** runLoop + StreamFn + `message_update` 流式
  - [x] **16.4** resolveRunConfig + Agent 类（abort / settlement）
  - [x] **16.5** harness 接入：RunCommitPort + composeContext
  - [ ] **16.6** RunEvent JSONL + Slint subscribe
  - [ ] **16.7** plugin-host 窄 IPC；删 HookPhase / derive；`pnpm check`

- [x] **17. Monorepo 按域拆包 · 消除根 `src/`（§16 M7 后）**

  **Modular monorepo / package by bounded context**：域包在 `packages/*`，CLI 与装配在 `apps/moontide`；**根无 `src/` monolith**。

  - 详述：[`docs/notes/monorepo-packages.md`](docs/notes/monorepo-packages.md) · [`docs/notes/agent-core-roadmap.md`](docs/notes/agent-core-roadmap.md) §12
  - 包：`@moontide/shared` · `llm` · `session` · `context-composer` · `log` · `tools` · `plugins-sdk` · `sidecar-host` · `apps/moontide`
  - 验收：architecture-boundaries package 级规则；根无 `src/`（`pnpm run check`）

- [ ] **1. Slint 桌面样式优化**
  - 透明虚化效果
  - 动效
  - 桌面背景
  - 渐入渐出过渡

- [ ] **2. Pin Notes 随手记（Buoy）**

- [ ] **3. 功能树设计**
  - 类似 Project 树结构
  - 探讨是否合理

- [ ] **4. 对话 AI 自动分类**
  - 对话 Tag
  - Project Tree 自动整理

- [ ] **5. 虚拟人物**

- [ ] **6. Session — Context Window（C6+）**
  - C1–C6 **done**（TS harness）· **Context Budget Tiers done**
  - 开发计划（六件事）：[`docs/notes/context-window-roadmap.md`](docs/notes/context-window-roadmap.md) — **#1–#6 + Budget Tiers 均 done**
  - Spec：[`context-composer.md`](docs/spec/context-composer.md) · Utils：[`utils-infrastructure.md`](docs/notes/utils-infrastructure.md) · Backlog：[`context-backlog.md`](docs/notes/context-backlog.md)
  - **下一阶段四条轨** → 见 **§15**

- [ ] **15. 后续开发计划（2026-08 起）**

  六件事与 Context Budget Tiers 完成后，按下列顺序推进（详表见 [`context-window-roadmap.md` §8](docs/notes/context-window-roadmap.md)）：

  - [ ] **15.1 Prompt Prefix Cache**
    - 稳定 system / instruction / tool-definitions prefix 复用，降低 latency 与 input cost
    - 详设：[`context-backlog.md` §15](docs/notes/context-backlog.md) · [`context-normalization.md` §13](docs/notes/context-normalization.md)

  - [ ] **15.2 需求讨论（Design / Requirements）**
    - 实现前对齐：Agent Activity Model（7a–7c）、Normalization 边界、Local Fusion 成本模型
    - 讨论备忘：[`agent-activity-model-discussion.md`](docs/notes/agent-activity-model-discussion.md)
    - 产出：各轨一页纸 spec / 验收标准，再开实现 PR

  - [ ] **15.3 Local 小模型 + 路由（Local Fusion）**
    - 本地微调/量化小模型处理低复杂度任务，降低 cloud API token 成本
    - **类比 OpenRouter Fusion，但是 edge local router** — 在设备侧做 tier 路由，非 provider upstream 竞价
    - `moontide/router-v1` catalog · Model Router · `moontide-infer` sidecar
    - 详设：[`edge-local-models.md`](docs/notes/edge-local-models.md) · [`llm-provider.md`](docs/spec/llm-provider.md) §3.4 / §10

  - [ ] **15.4 Conversation Normalization（Preflight / Postflight）**
    - 每次 LLM request 前：统一 Context Projection + `ContextManifest`（预算、配对、provider 不变量）
    - 完整 Agent turn 后：usage / delta / 下一轮 preflight 状态
    - 详设：[`context-normalization.md`](docs/notes/context-normalization.md)

- [ ] **7. Feature 基线性能测试套件**
  - **详设：** [`docs/notes/agent-eval-roadmap.md`](docs/notes/agent-eval-roadmap.md) — Agent Feature 评测流水线（L0–L3 · 分桶 suite · grader · Impact Card）
  - **v0 → v3 分期：** PR 档 deterministic grader → nightly 真 LLM + baseline delta → SWE-bench 子集
  - 自动化测试完善（L0/L1 仍在 `tests/`；L2+ 在 `eval/`）
  - 测量与评估
  - SWE-bench 等公开 agent/coding benchmark（**L3**，对齐 roadmap §8 v3）
  - **DeepSeek DSBench（后续讨论需纳入）**
    - DeepSeek 内部 coding-agent 评测集，含 **DSBench-FullStack**（全栈开发）与 **DSBench-Hard**（高难度 agent 任务）
    - 官方分数多在 **DeepSeek Harness**（minimal mode）上测得；与 harness 设计强相关，**暂不可独立复现**
    - 价值：观察 DeepSeek 对 agent 能力的定义与优化方向；设计 MoonTide 基线 suite（**coding / deep_protocol 桶**）时可对照其任务形态（terminal / multi-tool / 长链路 coding），但不替代 SWE-bench 等第三方 leaderboard
    - 参考：[DeepSeek-V4-Flash model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731) · DeepSeek Harness（待发布）

- [ ] **8. Prompts 评分**
  - 并入 eval **rubric grader**（roadmap v2）· 主要服务 **general_knowledge（C 桶）** guard metrics
  - 详设：[`docs/notes/agent-eval-roadmap.md`](docs/notes/agent-eval-roadmap.md) §5.2 · §4

- [ ] **9. 日常 Action 统计控件（Tide）**
  - 多 UI 组件之一：可视化「今天做了什么 / 最近做了什么」
  - 数据源不限于 MoonTide app 内，覆盖电脑上的日常操作（窗口切换、应用使用、文件编辑、终端命令、浏览器等）
  - 作为独立 panel / widget 嵌入 **MoonTide**，持续监控并汇总 daily action
  - 与 AgentEvent / trace 打通，区分「人做的」与「agent 做的」
  - 远期：时间线视图、分类 Tag、与 Project Tree / Session（**Bruma**）关联

- [ ] **10. 多 UI 窗口 — MoonTide（借鉴 Vibe Island）**
  - 从当前单 Slint sidecar 演进为多 panel / 多窗口桌面 shell
  - 参考 Vibe Island 的布局与交互：浮动 panel、可 dock、可 pin、渐入渐出
  - 每个 panel 是独立控件（Tide、Fleet、Buoy 等）
  - 与 **1. Slint 桌面样式优化** 联动（透明虚化、动效、背景）
  - 架构讨论见 [`docs/notes/runtime-multilang.md`](docs/notes/runtime-multilang.md)

- [x] **11. 产品命名 — 已定稿**
  - 见 [`docs/product/vision.md`](docs/product/vision.md)
  - **当前产品：MoonTide**（repo `moontide/`、工作区 `.moontide/`、`MOONTIDE_*`）
  - **MoonTide** 为当前产品名，由 **OceanSpark** 开发；**Ciel · Lyra · Zephyr · Bruma** 为保留产品名；**Tide · Fleet · Buoy** 为 MoonTide 内组件代号

- [ ] **12. 多 Agent 进程监控（Fleet）**
  - 在 **MoonTide** 中实时查看多个 agent 的运行状态（进行中 / 等待 / 完成 / 失败）
  - 统一展示：run id、provider、当前 tool、token / context 用量、最近事件
  - 消费现有 AgentEvent JSONL + 各产品 status / session 文件

- [ ] **13. Agent 迁移与 Zephyr（无痛换产品）**
  - 作为后来者：降低从 Cursor / Claude Code / Codex / CodeWhale / Reasonix / Pi Agent 等迁移的摩擦
  - **Zephyr**：在 MoonTide 中管理不同 agent 产品的 conversation 与 task，换风而不截断 **Bruma**
  - Panel 能力：
    - 查看 Codex agent 运行情况
    - 查看 Claude Code 运行情况
    - 选择指定 agent（Codewhale / Reasonix / Pi Agent / Cursor / Codex / Claude Code 等）进行对话
    - 向选定 agent 派发任务
  - 适配层：各产品 session / transcript / status 格式的 reader + 可选 writer
  - 与 **6. Bruma**、context-window 设计对齐（**Session Event Log** 作为 source of truth；见 [`docs/spec/context-composer.md`](docs/spec/context-composer.md)）

- [ ] **14. Agent 外网数据源可达性与体验（国内网络）**
  - **背景**：大量国内用户无法稳定访问 GitHub、Google 等外网数据源；agent 拉依赖、搜文档、clone、调 API 时易失败
  - **目标**：在 **MoonTide** 与相关工具链上做可达性优化与体验提升；即使无法彻底解决连通，也要有明确降级、错误说明与替代路径
  - **探索方向**（非本期实现承诺）：
    - 失败时可读的错误与建议（镜像、代理、本地缓存、离线知识）
    - 可选镜像 / 国内可替代源的探测与配置
    - 工具层超时、重试与「外网不可达」分类，避免无限挂起
    - 与 **Zephyr** / 多 agent 场景的一致性提示（各产品外网策略不同时的 UX）
