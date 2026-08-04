# TODO

> 产品方向：[`docs/product/vision.md`](docs/product/vision.md) · 当前计划：[`docs/product/plan.md`](docs/product/plan.md) · 设计索引：[`docs/README.md`](docs/README.md)

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

- [ ] **6. Session — Context Window 后续（C6+）**
  - C1–C6 **done**（TS harness）
  - 开发计划（六件事）：[`docs/notes/context-window-roadmap.md`](docs/notes/context-window-roadmap.md)
    1. ~~runtime-status~~ **done**
    2. ~~Hook/Plugin 内核机制~~ **done** — HookDispatcher + sidecar
    3. ~~Session Observe~~ **done** — log-sync · event-hub
    4. ~~instruction-state~~ **done**
    5. **LLM Provider A–C** — **进行中**
    6. ~~legacy / deprecated 清理 + utils 抽离~~ **done**
  - Spec：[`context-composer.md`](docs/spec/context-composer.md) · Utils：[`utils-infrastructure.md`](docs/notes/utils-infrastructure.md) · Backlog：[`context-backlog.md`](docs/notes/context-backlog.md)

- [ ] **7. Feature 基线性能测试套件**
  - 自动化测试完善
  - 测量与评估
  - SWE Benchmark

- [ ] **8. Prompts 评分**

- [ ] **9. 日常 Action 统计控件（Tide）**
  - 多 UI 组件之一：可视化「今天做了什么 / 最近做了什么」
  - 数据源不限于 Ocula app 内，覆盖电脑上的日常操作（窗口切换、应用使用、文件编辑、终端命令、浏览器等）
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
  - **当前产品：Ocula**（repo `ocula/`、工作区 `.ocula/`、`OCULA_*`）
  - **Ciel · Lyra · MoonTide · Zephyr · Bruma** 为保留产品名；**Tide · Fleet · Buoy** 为 MoonTide 内组件代号；均不用于现行 Ocula 产品名或实现模块名

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
  - **目标**：在 **Ocula** 与相关工具链上做可达性优化与体验提升；即使无法彻底解决连通，也要有明确降级、错误说明与替代路径
  - **探索方向**（非本期实现承诺）：
    - 失败时可读的错误与建议（镜像、代理、本地缓存、离线知识）
    - 可选镜像 / 国内可替代源的探测与配置
    - 工具层超时、重试与「外网不可达」分类，避免无限挂起
    - 与 **Zephyr** / 多 agent 场景的一致性提示（各产品外网策略不同时的 UX）
