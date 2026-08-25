# Desktop Protocol

> **状态：** Tauri/Agent Host 进程边界的第一版 wire DTO；不依赖具体 UI、Tauri 或 Agent runtime。

`desktop-protocol` 是 MoonTide Desktop 的跨进程消息契约。它只描述 command、response、event、snapshot、错误和 delivery identity，不拥有 Agent、SessionStore、窗口或 transport 生命周期。

## 使用者

- 当前同进程 Desktop Host 的私有 adapter 将 canonical runtime values 转换为这里的 DTO；
- D4 的独立 `agent-host` 将复用同一 DTO 与转换所有权；
- Tauri Rust shell 通过本地 transport 发送和接收 envelope；
- Web frontend 使用同一 JSON shape 生成 TypeScript 类型或 fixture。

该 crate 不依赖 `agent`、`agent-core`、Tauri 或 Tokio channel。跨边界类型必须保持可 JSON 序列化，runtime ownership 类型不得进入协议。

## 当前公开语义

- `request_id` 只用于 command/response correlation；
- `connection_epoch` 标识一次连接生成；
- `seq` 只保证同一 epoch 内的 event delivery order；
- resync 通过 `DesktopSnapshotDto` 建立新基线，不 replay 旧 seq；
- `AssistantResponseSnapshot` 是临时 view，`AssistantFinalized` 负责收敛为历史内容；
- command、response、event 都通过 `DesktopMessageEnvelope` 传输。

frame transport 的读写和本地 socket 生命周期不属于本 crate；它们由 Host 与 Tauri shell 的 adapter 实现。
