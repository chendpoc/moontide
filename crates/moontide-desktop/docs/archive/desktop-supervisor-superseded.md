# Desktop Supervisor Design

## Ownership

```text
Tauri Rust shell / future supervisor process
        │ owns ProcessSupervisor
        ├── agent-host
        ├── plugin-host
        ├── mcp-server
        └── tool-worker
```

每个 child 由一个 `ProcessSpec` 描述并获得唯一 `ProcessId`。child 不拥有其他 child，也不接收 WebView 的原始 spawn 请求。

## Lifecycle

```text
Prepared → Starting → Running → Exited
                              ├── code
                              ├── killed
                              └── failed
```

`ProcessSupervisor` 只负责 OS process lifecycle。上层 adapter 必须先通过 child protocol 完成 handshake、发送业务 shutdown 并等待正常退出；只有超时后才调用 `kill`。

## Local endpoint

macOS/Linux 使用 Unix socket path；Windows 使用 named-pipe name。endpoint 只命名连接位置，不实现 socket IO。当前 crate 首先实现 endpoint allocation 和 Unix-compatible process bookkeeping；具体 framed JSON transport 属于 Host/Tauri adapter。

每次 spawn 使用唯一 endpoint，避免复用未知存活的旧 socket。supervisor 只清理自己登记过的 endpoint，不递归删除 runtime directory。

## Failure semantics

- child spawn 失败：不登记为 Running，返回带 role/id 的错误；
- child 非零退出：状态为 `Exited { code }`，不自动重放业务请求；
- child 被 supervisor kill：状态为 `Killed`；
- graceful shutdown 的协议语义由上层处理；
- 崩溃后的 restart 必须创建新的 process generation 和 endpoint。
