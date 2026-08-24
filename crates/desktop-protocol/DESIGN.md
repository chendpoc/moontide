# Desktop Protocol Design

## 所有权

```text
agent / agent-host canonical values
        │ adapter
        ▼
desktop-protocol DTO
        │ JSON frame
        ▼
Tauri Rust shell / Web frontend
```

协议 crate 只拥有 wire shape 和版本常量。它不读取 Session Item Log，不创建 Agent，不决定 permission，也不管理连接。

## Envelope

`DesktopMessageEnvelope` 包含四类跨边界 identity：

- `protocol_version`：顶层协议版本；
- `request_id`：command 与 response 的匹配键；
- `connection_epoch`：连接生成；
- `seq`：当前 epoch 内的 event 顺序。

没有 `request_id` 的 event 不能被前端当成 response；没有 `seq` 的 command/response 不能参与 event gap 判断。

## DTO 边界

`SessionSnapshotDto`、`ModelResponseSnapshotDto`、`ToolCallDto`、`ToolResultDto` 和 `ApprovalRequestDto` 是独立 DTO，即使内部字段与 Rust canonical values 当前相似，也不通过类型依赖共享。这样可以在不引入 Agent runtime 的情况下让非 Rust consumer 生成 TypeScript 类型。

`MAX_FRAME_LENGTH` 为 16 MiB。超过该长度的 transport frame 必须由 transport adapter 拒绝；协议 crate 不执行 socket IO。

## 失败语义

- 未知或不支持的协议版本映射为 typed command error；
- 无法解析的 JSON/frame 由 transport 报告为连接错误；
- event 丢失不由协议层猜测，Host 通过 snapshot/resync 建立新基线；
- 协议 DTO 不携带 API key、Host handle、Tokio channel 或 task handle。
