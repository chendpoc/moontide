# TODO

> 产品方向：[`docs/product/vision.md`](docs/product/vision.md) · 当前计划：[`docs/product/plan.md`](docs/product/plan.md) · 设计索引：[`docs/README.md`](docs/README.md)

- [ ] **16. 内核 Rust 化（2026-08 起 · 当前主轨）**

  TypeScript 初版已删除（快照在 `main` 分支），内核按 crate 边界在 Rust 重建。目标模块清单与 crate 判据见
  [`docs/notes/runtime/agent-kernel-architecture.md`](docs/notes/runtime/agent-kernel-architecture.md) §6–§7。

  - 迁移执行 checklist：[`docs/notes/runtime/migration-plan.md`](docs/notes/runtime/migration-plan.md)
  - 设计 Spec：[`docs/spec/agent-core.md`](docs/spec/agent-core.md) · [`docs/spec/agent-events.md`](docs/spec/agent-events.md)

  - [x] **16.1** R0 主循环：Session Log → Composer → LLM → builtin tools（`moontide-agent` · `moontide-cli`）
  - [ ] **16.2** Agent Event JSONL + `status.json` 写入（`moontide-ui` 消费侧已就绪）
  - [ ] **16.3** RunEvent bus 与 run 生命周期（abort / settlement）
  - [ ] **16.4** `/status`、`/compact` 等 REPL 命令补齐
  - [ ] **16.5** 权限与 approval 的 crate 边界收敛

- [ ] **17. 跨语言契约（`schema/`）**

  只有被两种以上语言消费的契约才落 `schema/`（见 [`schema/README.md`](schema/README.md)）。

  - [ ] **17.1** Agent Event / session item 的 JSON Schema 与版本化规则
  - [ ] **17.2** Rust 侧类型与 schema 的一致性校验（生成或断言）

- [ ] **18. 多语言边界（后置到真实需求）**

  - [ ] **18.1** `services/`（Go）—— 常驻监控 / 代理进程；`go.mod` 等首个 service 需求出现再建
  - [ ] **18.2** `node/`（Node）—— MCP server 与扩展包；pnpm workspace 同上后置
  - [ ] **18.3** Rust benchmark 基线（loop / compose / tool pipeline）

- [ ] **19. 插件设计 Agent（用户扩展需求处理链路）**

  候选设计：[`crates/docs/extension-request-pipeline.md`](crates/docs/extension-request-pipeline.md)。

  - 流程：需求 → 意图澄清（grill-me 式）→ 结构化 brief → 判断（决策树）→ draft → review → judge 门禁 → 产物
  - 前置依赖：extension 契约（MCP 协议 + sidecar hook schema，见 17 / 18）先定稿；brief JSON schema 先定义
  - 执行选型后置：本地小模型（LoRA）为未来优化，先用 prompting + JSON schema + few-shot 验证链路

- [ ] **20. 分层 Context 与长期记忆（L0/L1/L2 + session→memory 蒸馏）**

  候选设计：[`crates/docs/tiered-context-memory.md`](crates/docs/tiered-context-memory.md)。

  - 借鉴 OpenViking 设计思想（非代码 / 服务）：L0/L1/L2 分层懒加载、确定性 URI + 检索轨迹、session→memory 蒸馏
  - 自研 Rust 精简版，不 embed（AGPLv3 + Python server）；复用服务仅走 MCP
  - 边界：短期 session（确定性可重放）与长期记忆（概率性辅助）分离

- [ ] **21. 扩展边界与 Sidecar Runtime**

  候选设计：[`crates/docs/extension-sidecar-runtime.md`](crates/docs/extension-sidecar-runtime.md)。

  - 扩展边界 = sidecar（进程间）+ MCP（JSON-RPC over stdio）；隔离靠 OS 进程边界强制，非约定
  - runtime 成本分配：共享 runtime 默认（O(版本数)）+ embedded 例外（O(N) 重复）；TS 扩展繁多，不默认打包单文件
  - 落地：manifest 声明 `runtime: shared | embedded` + 版本；产品维护共享缓存 `~/.moontide/runtime/{runtime}/{version}/`

- [ ] **22. 日志与 Session 设计**

  候选设计：[`crates/docs/logging-and-session-design.md`](crates/docs/logging-and-session-design.md)。

  - 三流物理分离：session log（可重放事实）· logger（可丢弃诊断，stderr）· stdout（外部消费数据）
  - session log 四不变量：`seq == log.len()`、先校验后冻结、模型可见先入 log、header 外置
  - 双写原则：生命周期事实双写，session log 记「发生了什么」，logger 记「怎么发生」

- [ ] **1. Slint 桌面样式优化**
  - 透明虚化效果
  - 动效
  - 桌面背景
  - 渐入渐出过渡

- [ ] **2. Pin Notes 随手记（Buoy）**
  - 桌面 pending **spark** 收件箱；对接 Spark 移动端 sync
  - 产品方向：[`docs/product/spark.md`](docs/product/spark.md)

- [ ] **3. 功能树设计**
  - 类似 Project 树结构
  - 探讨是否合理

- [ ] **4. 对话 AI 自动分类**
  - 对话 Tag
  - Project Tree 自动整理

- [ ] **5. 虚拟人物**

- [ ] **6. Session — Context Window（C6+）**
  - C1–C6 **done**（TS harness）· **Context Budget Tiers done**
  - 开发计划（六件事）：[`context-window-roadmap.md`](docs/archive/notes/context/context-window-roadmap.md) — **#1–#6 + Budget Tiers 均 done（TS 实现）**
  - Spec：[`context-composer.md`](docs/spec/context-composer.md) · Utils：[`utils-infrastructure.md`](docs/archive/notes/runtime/utils-infrastructure.md) · Backlog：[`context-backlog.md`](docs/archive/notes/context/context-backlog.md)
  - **下一阶段四条轨** → 见 **§15**

- [ ] **15. 后续开发计划（2026-08 起）**

  六件事与 Context Budget Tiers 完成后，按下列顺序推进（详表见 [`context-window-roadmap.md` §8](docs/archive/notes/context/context-window-roadmap.md)）：

  - [ ] **15.1 Prompt Prefix Cache**
    - 稳定 system / instruction / tool-definitions prefix 复用，降低 latency 与 input cost
    - 详设：[`context-backlog.md` §15](docs/archive/notes/context/context-backlog.md) · [`context-normalization.md` §13](docs/archive/notes/context/context-normalization.md)

  - [ ] **15.2 需求讨论（Design / Requirements）**
    - 实现前对齐：Agent Activity Model（7a–7c）、Normalization 边界、Local Fusion 成本模型
    - 讨论备忘：[`agent-activity-model-discussion.md`](docs/archive/notes/context/agent-activity-model-discussion.md)
    - 产出：各轨一页纸 spec / 验收标准，再开实现 PR

  - [ ] **15.3 Local 小模型 + 路由（Local Fusion）**
    - 本地微调/量化小模型处理低复杂度任务，降低 cloud API token 成本
    - **类比 OpenRouter Fusion，但是 edge local router** — 在设备侧做 tier 路由，非 provider upstream 竞价
    - `moontide/router-v1` catalog · Model Router · `moontide-infer` sidecar
    - 详设：[`edge-local-models.md`](docs/notes/llm/edge-local-models.md) · [`llm-provider.md`](docs/spec/llm-provider.md) §3.4 / §10

  - [ ] **15.4 Conversation Normalization（Preflight / Postflight）**
    - 每次 LLM request 前：统一 Context Projection + `ContextManifest`（预算、配对、provider 不变量）
    - 完整 Agent turn 后：usage / delta / 下一轮 preflight 状态
    - 详设：[`context-normalization.md`](docs/archive/notes/context/context-normalization.md)

- [ ] **7. Feature 基线性能测试套件**
  - **详设：** [`agent-eval-roadmap.md`](docs/archive/notes/evals/agent-eval-roadmap.md) — Agent Feature 评测流水线（L0–L3 · 分桶 suite · grader · Impact Card）
  - **v0 → v3 分期：** PR 档 deterministic grader → nightly 真 LLM + baseline delta → SWE-bench 子集
  - **TS 时代成果已随实现删除**（六类 58 case suite · subprocess worker · HTTP VCR · baseline / merge-gate / Impact Card）；Rust 侧需重建
  - [ ] Rust eval harness：case 定义、grader 与 baseline delta
  - [ ] nightly 真 LLM 全量 + CI artifact
  - [ ] SWE-bench 等公开 agent/coding benchmark（**L3**，对齐 roadmap §8 v3）
  - **DeepSeek DSBench（后续讨论需纳入）**
    - DeepSeek 内部 coding-agent 评测集，含 **DSBench-FullStack**（全栈开发）与 **DSBench-Hard**（高难度 agent 任务）
    - 官方分数多在 **DeepSeek Harness**（minimal mode）上测得；与 harness 设计强相关，**暂不可独立复现**
    - 价值：观察 DeepSeek 对 agent 能力的定义与优化方向；设计 MoonTide 基线 suite（**coding / deep_protocol 桶**）时可对照其任务形态（terminal / multi-tool / 长链路 coding），但不替代 SWE-bench 等第三方 leaderboard
    - 参考：[DeepSeek-V4-Flash model card](https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731) · DeepSeek Harness（待发布）

- [ ] **8. Prompts 评分**
  - 并入 eval **rubric grader**（roadmap v2）· 主要服务 **general_knowledge（C 桶）** guard metrics
  - 详设：[`agent-eval-roadmap.md`](docs/archive/notes/evals/agent-eval-roadmap.md) §5.2 · §4

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
  - 架构讨论见 [`docs/notes/runtime/runtime-multilang.md`](docs/notes/runtime/runtime-multilang.md)

- [x] **11. 产品命名 — 已定稿**
  - 见 [`docs/product/vision.md`](docs/product/vision.md)
  - **当前产品：MoonTide**（repo `moontide/`、工作区 `.moontide/`、`MOONTIDE_*`）
  - **MoonTide** 为当前产品名，由 **OceanSpark** 开发；**Spark · Ciel · Lyra · Zephyr · Bruma** 为保留产品名；**Tide · Fleet · Buoy** 为 MoonTide 内组件代号；Spark 见 [`docs/product/spark.md`](docs/product/spark.md)

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
