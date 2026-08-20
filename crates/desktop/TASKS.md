# Desktop Shell TASKS

> **来源：** [`DESIGN.md`](DESIGN.md) 与 [`README.md`](README.md)
> **批次规则：** 每批实现后运行 `just check`，停等用户 review；用户明确要求 commit 后才提交。

## Review 批次

| 批次 | 范围 | 状态 | 交付证据 |
|---|---|---|---|
| D0 | README、DESIGN、UI-STATE、UI-INTERACTION、TASKS baseline | ☑ | 架构与 UI review 完成 |
| D0.5 | UI 技术选型、布局、组件状态、快捷键和异常交互 review | ☑ | Iced confirmed；Electron 排除；Tauri 后置 |
| D1 | Host actor、ordered EventBuffer、single active turn | ☑ | `cargo test -p desktop` + host lifecycle tests |
| D2 | Desktop protocol 顶层 contract、identity/resync 语义、in-process transport adapter | ☑ | contract + adapter tests；不要求全量 payload 搬迁 |
| D3 | RenderState fold、Iced single-window shell、conversation/input/tool panels | ☐ | fold tests + desktop build + UI smoke |
| D4 | `agent-host` process、framed transport、disconnect/resync | ☐ | process lifecycle + reconnect acceptance |
| D5 | Session picker、resume、settings/key injection | ☐ | query/recovery/settings tests |
| D6 | provider smoke、cross-platform build/package | ☐ | macOS/Windows/Linux build matrix and smoke report |

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
- [x] 暂不复制全部 canonical value payload；D4 出现真实 framed transport、独立版本或非 Rust consumer 后，再抽取必要 wire DTO。

## D3–D6 细项

- [ ] Iced Message/update/view 与 RenderState 单向绑定，并按 [`UI-INTERACTION.md`](UI-INTERACTION.md) 验收布局和状态；
- [ ] 实现 `AssistantDraftKey(turn, llm_call_id)` 替换、`AssistantFinalized` 清理和 conversation fold；
- [ ] 实现 ToolCall/ToolResult/approval/error 的 projection；
- [ ] 保留输入 draft，不把 transient snapshot 写入 Session；
- [ ] approval card、tool detail、error notice、cancel/close affordance；
- [x] `ApprovalBroker` 的唯一决策和 cancellation cleanup；
- [x] 关闭顺序：cancel → await turn → flush Progress → flush diagnostic log → stop；
- [x] `SessionQuery` list/load 与 `Agent::resume` 恢复路径；
- [ ] `agent-host` binary 只拥有 Agent runtime，Desktop 只拥有 Iced RenderState；
- [ ] UI 断线后进入 Disconnected，重连必须先 Snapshot 再消费新 epoch 事件；
- [ ] `.moontide/settings.json` 解析、API key 注入和 workspace switching；
- [ ] macOS、Windows、Linux 的平台编译和打包接缝；
- [ ] 至少一个真实 provider 流式 smoke test。

## 后置，不进入 v0.1

- [ ] 多 Session 并发；
- [ ] 后台 queue、scheduler、multi-agent；
- [ ] daemon、server、sidecar；
- [ ] fork、diff、文件索引和跨设备同步。

这些项目只有出现明确消费者、资源 ownership 和恢复需求后重新架构对齐。
