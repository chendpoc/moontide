# Desktop Shell TASKS

> **来源：** [`DESIGN.md`](DESIGN.md) 与 [`README.md`](README.md)
> **批次规则：** 每批实现后运行 `just check`，停等用户 review；用户明确要求 commit 后才提交。

## Review 批次

| 批次 | 范围 | 状态 | 交付证据 |
|---|---|---|---|
| D0 | README、DESIGN、UI-STATE、UI-INTERACTION、TASKS baseline | ☑ | 架构与 UI review 完成 |
| D0.5 | UI 技术选型、布局、组件状态、快捷键和异常交互 review | ☑ | Tauri + 轻量 Web 前端方向确认；推荐 Svelte + TypeScript；Electron/Iced 排除 |
| D1 | Host actor、ordered EventBuffer、single active turn | ☑ | `cargo test -p desktop` + host lifecycle tests |
| D2 | Desktop protocol 顶层 contract、identity/resync 语义、in-process transport adapter | ◐ replan | 现有 Rust contract 保留；Tauri 前置要求独立 wire DTO、TS types/fixtures conformance |
| D3 | RenderState fold、Tauri single-window shell、conversation/input/tool panels | ☐ | fold tests + Tauri build + UI smoke |
| D3-R1 | Protocol-fed RenderState fold and baseline resync | ☑ | Rust-side pure fold tests；不绑定 UI framework |
| D3-R2 | Tauri bridge、轻量 Web 前端和 protocol subscription seam | ☐ | bridge tests + frontend tests + Tauri smoke；不引入 settings/IPC beyond bridge |
| D3-R3 | Inspector、Tool/Approval/Thinking detail and local selection | ☐ | frontend state/component tests；不引入 Host/protocol API |
| D4 | `agent-host` process、framed transport、disconnect/resync | ☐ | process lifecycle + reconnect acceptance |
| D5 | Session picker、resume、settings/key injection | ☐ | query/recovery/settings tests |
| D6 | provider smoke、cross-platform build/package | ☐ | macOS/Windows/Linux system WebView build matrix and smoke report |

> **Replan note（2026-08-21）：** 用户确认放弃 Iced，Desktop UI 改为 Tauri + 轻量 Web 前端。
> 当前工作区的未提交 Iced shell 改动不在本次架构文档批次中删除；它们不是新的验收证据，
> 也不得继续扩展。下一批先完成 protocol wire DTO / TypeScript conformance，再实现 Tauri
> vertical slice，之后删除 Iced 依赖和对应代码。

## D1 细项

- [x] 建立 `crates/desktop` workspace crate，依赖方向为 `desktop → agent`；
- [x] 实现 `DesktopHost::start` 和 Host actor ownership；
- [x] 实现 Idle/Busy/Stopping command acceptance；
- [x] 将 `ProgressObserver` 接入 ordered EventBuffer；
- [x] 实现 event envelope seq、snapshot coalescing、resync marker；
- [x] 实现 `DesktopSnapshot` 的最小 host state；
- [x] 覆盖 create、snapshot、busy、shutdown 和 worker flush。

## D2 细项

- [x] 冻结 version、request_id、connection_epoch、seq、command、response、event、snapshot 的顶层语义；
- [x] 定义不包含 Tokio channel / Host handle 的纯协议 command DTO；
- [x] 保留当前单一有序 EventBuffer 和 snapshot baseline resync 语义；
- [x] 提供 in-process transport adapter，使 D3 不依赖具体 IPC；
- [x] 明确协议不暴露 Agent runtime ownership 类型，不写 Session、不持有 approval truth、不携带 API key；
- [ ] 为 Tauri 非 Rust consumer 冻结独立 wire DTO，并生成/校验 TypeScript types 与 fixtures；
- [x] 保留稳定的 identity/resync 语义；原先“D4 才抽取 wire DTO”的假设因 Tauri frontend consumer 出现而失效。

## D3–D6 细项

- [ ] Tauri bridge + 轻量 Web frontend 与 RenderState 单向绑定，并按 [`UI-INTERACTION.md`](UI-INTERACTION.md) 验收布局和状态；
- [ ] 实现 `AssistantDraftKey(turn, llm_call_id)` 替换、`AssistantFinalized` 清理和 conversation fold；
- [x] 实现 ToolCall/ToolResult/approval/error 的 projection；
- [x] 启动时加载 `DesktopSnapshot`，渲染 live tool projection，并按 active assistant-call identity 安全保留 draft；
- [x] Snapshot 建立 delivery baseline 前暂存事件，完成后按 seq 顺序重放，避免初始 boot race；
- [x] Composer 使用多行 editor；普通 Enter 换行，Cmd/Ctrl+Enter 提交，Esc 取消 active Turn 或关闭 Inspector；
- [ ] 保留输入 draft，不把 transient snapshot 写入 Session；
- [ ] approval card、tool detail、error notice、cancel/close affordance；
- [x] `ApprovalBroker` 的唯一决策和 cancellation cleanup；
- [x] 关闭顺序：cancel → await turn → flush Progress → flush diagnostic log → stop；
- [x] `SessionQuery` list/load 与 `Agent::resume` 恢复路径；
- [ ] `agent-host` binary 只拥有 Agent runtime，Tauri desktop shell 只拥有 bridge，Web frontend 只拥有 RenderState；
- [ ] UI 断线后进入 Disconnected，重连必须先 Snapshot 再消费新 epoch 事件；
- [ ] `.moontide/settings.json` 解析、API key 注入和 workspace switching；
- [ ] macOS、Windows、Linux 的平台编译和打包接缝；
- [ ] 至少一个真实 provider 流式 smoke test。

## D3-R1 细项

- [x] 将 UI 输入边界统一为 `DesktopMessageEnvelope` / `DesktopProtocolEvent`；
- [x] 实现 UI-owned `RenderState`、draft replacement、conversation/tool/approval projection；
- [x] 实现 seq stale/gap、epoch reset 和 snapshot baseline replacement；
- [x] 覆盖 orphan ToolResult、重复 finalized 和 resync notice；
- [x] 不引入具体 UI framework、窗口、settings 或 transport；RenderState 保持 framework-neutral。

## D3-R2 细项（Tauri replan）

- [ ] Tauri Rust shell 注入 protocol client，不负责 Agent/settings bootstrap；
- [ ] `DesktopMessageEnvelope` → Tauri bridge → frontend protocol client → `RenderState`；
- [ ] 轻量 Web frontend 接入最小 conversation、composer、Stop、approval/error；
- [ ] 覆盖 command/response correlation、event subscription、单消费者和 assistant snapshot fold；
- [ ] 不引入 Session picker、完整 Inspector、D5 settings 或 daemon；
- [ ] 为 Tauri capability 建立最小 allowlist，未经授权的 command 不可调用。

## D3-R3 细项

- [ ] 增加 UI-owned Inspector open/close 与当前 Tool/Approval/Thinking selection；
- [ ] Tool card 支持选择，Inspector 显示 canonical call input、result content 和 typed status；
- [ ] Approval card 支持选择，Inspector 显示 request、参数摘要和当前决策入口；
- [ ] Thinking 默认折叠，可从 assistant draft 打开详情；
- [x] finalized assistant 的 Conversation 摘要默认隐藏 Thinking，详情仍由 Inspector 显式打开；
- [ ] Inspector 关闭不改变 Host、approval 或 RenderState 事实；
- [ ] 不引入 Session Rail、Session picker、settings、Host/protocol API 或 D4 IPC。

## 后置，不进入 v0.1

- [ ] 多 Session 并发；
- [ ] 后台 queue、scheduler、multi-agent；
- [ ] daemon、server、sidecar；
- [ ] fork、diff、文件索引和跨设备同步。

这些项目只有出现明确消费者、资源 ownership 和恢复需求后重新架构对齐。
