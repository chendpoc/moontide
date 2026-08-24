# Desktop Supervisor

> **状态：** 第一版子进程生命周期接缝；不拥有 Agent、Session 或插件协议。

`desktop-supervisor` 是 Tauri Rust shell 与后续 standalone supervisor 共用的子进程管理边界。它负责：

- 为 child role 分配稳定的 process identity；
- 创建本地 endpoint 名称；
- spawn 和登记 child process；
- 观察退出状态；
- 为 graceful protocol shutdown 提供 kill escalation 接缝；
- 清理由本 supervisor 创建的 runtime endpoint。

当前 child role：`AgentHost`、`PluginHost`、`McpServer`、`ToolWorker`。

本 crate 不负责：

- AgentLoop 或 SessionStore；
- command/event wire protocol；
- plugin manifest 或 Node runtime 下载；
- 自动重试 Agent Turn；
- 给 WebView 暴露任意 spawn 权限。
