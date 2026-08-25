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

### Envelope validation

v1 consumer 必须在进入 domain command 或 `RenderState` 之前按 payload kind 校验 identity：

| Payload | `request_id` | `connection_epoch` | `seq` |
|---|---|---|---|
| Handshake command | 必须存在且非空 | 必须为空 | 必须为空 |
| 其他 command | 必须存在且非空 | 必须存在 | 必须为空 |
| Response | 必须存在且非空，并回显 command identity | handshake accepted 后必须存在 | 必须为空 |
| Event | 必须为空 | 必须存在 | 必须存在且在当前 epoch 内严格递增 |

顶层 `protocol_version` 必须等于 `DESKTOP_PROTOCOL_VERSION`。未知 version、错误 payload kind、
缺失或冲突 identity 由 Host/client adapter 拒绝，不进入 Agent 或 frontend fold。协议 crate
只定义 shape 和常量，不拥有连接状态，因此具体 validation result 与 connection close 策略由
adapter 实现。

`request_id` 只匹配一次 terminal response。event 即使由某个 command 触发也不能携带该
request ID；response 即使与 event 同时到达也不能携带 event seq。Session Item 的 `seq`
是持久化事实顺序，不参与这里的 delivery gap 判断。

## DTO 边界

`SessionSnapshotDto`、`ModelResponseSnapshotDto`、`ToolCallDto`、`ToolResultDto` 和 `ApprovalRequestDto` 是独立 DTO，即使内部字段与 Rust canonical values 当前相似，也不通过类型依赖共享。这样可以在不引入 Agent runtime 的情况下让非 Rust consumer 生成 TypeScript 类型。

`MAX_FRAME_LENGTH` 为 16 MiB。超过该长度的 transport frame 必须由 transport adapter 拒绝；协议 crate 不执行 socket IO。

## 失败语义

- 未知或不支持的协议版本映射为 typed command error；
- payload kind 或 identity 组合非法时，adapter 在调用 domain command 前拒绝该 envelope；
- 无法解析的 JSON/frame 由 transport 报告为连接错误；
- event 丢失不由协议层猜测，Host 通过 snapshot/resync 建立新基线；
- 协议 DTO 不携带 API key、Host handle、Tokio channel 或 task handle。
