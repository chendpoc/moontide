
> 进程边界、Sidecar 监管与 IPC 设计备忘。  
> **非实现承诺** — 本地推理见 [`edge-local-models.md`](../llm/edge-local-models.md)；参考架构见 [`kocoro-architecture.md`](kocoro-architecture.md)；产品级 Release 与竞争定位见 [`platform-strategy.md`](../../product/platform-strategy.md)；Plugin host 与 MCP attach 见 [`plugin-host.md`](plugin-host.md)。

---

## 1. 项目目标

目标是构建一款：

- **macOS-first**
- 后续支持 Windows、Linux
- 使用 **Slint** 构建原生 UI
- 重视启动速度、内存占用和交互体验
- 主应用 Release 体积尽量控制在 **20 MB 以内**
- 充分利用 Node.js、Rust、Go 等语言各自的生态和运行时优势

这里不采用 `Node-first`、`Rust-first` 或 `Go-first` 的单语言思路，而是：

> 按能力域选择最合适的语言，通过稳定进程边界组合成一个产品。

---

## 2. 核心判断

### 2.1 不需要彻底抹平操作系统差异

跨平台 Agent 的目标不应是让所有平台拥有完全一致的底层行为，而应是：

```text
共享任务语义
+ 平台原生实现
+ 高频场景专项优化
```

macOS、Windows、Linux 在权限、进程、文件系统、Shell 和系统 API 上存在客观差异。

更合理的做法是：

- 通用文件、进程、网络能力共享接口；
- 平台特殊能力显式暴露；
- 根据真实失败数据补充平台优化；
- 不构建理论完备但成本高昂的统一 OS 抽象层。

### 2.2 Shell 不应成为核心协议

默认执行方式应是：

```text
program + argv[]
```

而不是自由形式 Shell 字符串。

例如：

```json
{
  "program": "git",
  "args": ["status", "--short"]
}
```

只有确实需要 Shell 语义时，才显式指定：

```json
{
  "shell": "zsh",
  "script": "..."
}
```

这样可以减少：

- 引号和转义问题；
- Shell 注入；
- 路径空格问题；
- Bash、PowerShell、cmd 差异；
- 输出解析不稳定。

---

## 3. 总体架构

```text
┌───────────────────────────────────────────┐
│ Slint UI                                  │
│ 原生窗口、交互和视图状态                    │
├───────────────────────────────────────────┤
│ Rust Host / Control Plane                 │
│ 生命周期、权限、IPC、平台能力、进程监管      │
├───────────────────────────────────────────┤
│ Node.js Agent Runtime                     │
│ MCP、插件、SDK、Agent 逻辑、npm 生态        │
├───────────────────────────────────────────┤
│ Optional Go Worker                        │
│ 长期任务、远程节点、调度和后台执行           │
├───────────────────────────────────────────┤
│ Optional WASM Plugins                     │
│ 沙箱插件和纯计算组件                        │
└───────────────────────────────────────────┘
```

架构原则：

> Rust Host 是桌面应用的控制平面，但不是全部业务逻辑的唯一实现语言。

---

## 4. 语言能力分工

## 4.1 Node.js / TypeScript

Node.js 负责 Agent 生态和高变化业务逻辑。

适合：

- MCP Client / Server；
- npm 插件；
- 模型 Provider SDK；
- Agent loop；
- Tool Definitions（`tools/`）；
- Prompt 与 Context 组装；
- Streaming；
- JSON Schema；
- SaaS Connector；
- 浏览器自动化；
- OAuth；
- 用户 JavaScript 扩展。

Node.js 的价值主要来自：

- AI 与 Agent SDK 生态成熟；
- npm 库丰富；
- JSON 和动态协议处理方便；
- 产品试错速度快；
- 插件开发门槛低。

Node.js 不应直接拥有全部宿主权限。

推荐调用方向：

```text
Node Agent
→ 请求系统工具
→ Rust Permission Broker
→ 原生执行
→ 返回结构化结果
```

---

## 4.2 Rust

Rust 负责原生应用宿主、平台能力和性能关键路径。

适合：

- Slint UI 集成；
- 应用生命周期；
- macOS 菜单、窗口和系统集成；
- Keychain；
- Accessibility；
- Apple Events；
- TCC 权限检测；
- Runtime 下载和管理；
- Sidecar 进程监管；
- Capability Broker；
- 敏感文件和进程操作；
- 索引、搜索、Diff、Parser；
- 条件编译和平台裁剪；
- 后续 Windows 原生能力。

Rust 的主要优势：

- 条件编译；
- 单二进制；
- 原生性能；
- 内存安全；
- 确定性资源管理；
- 跨平台系统 API；
- Slint 集成自然。

平台构建主要依赖：

```text
cfg
+ target-specific dependencies
+ Cargo features
+ LTO
+ dead-code elimination
```

---

## 4.3 Go

Go 不应仅因为“适合后台运行”而提前加入。

它适合在以下需求真实出现后引入：

- 长期运行的 Worker；
- Remote Agent；
- 多节点执行；
- Job Queue；
- Worker Pool；
- WebSocket / RPC Gateway；
- 跨设备同步；
- 后台下载；
- 服务端控制平面。

Go 的核心优势是：

- goroutine 并发模型简单；
- 网络和 RPC 生态成熟；
- 长期任务编排方便；
- 构建和部署简单；
- 团队维护成本低于 Rust。

职责可以概括为：

```text
Node：决定做什么
Go：保证任务长期可靠运行
Rust：决定是否允许，以及如何在宿主执行
```

单机 MVP 阶段不必立即引入 Go Sidecar。

---

## 4.4 WASM

WASM 不适合成为内部所有语言调用的统一 FFI。

它更适合：

- 第三方插件；
- 不可信代码沙箱；
- Parser；
- Transform；
- Rule Engine；
- 格式转换；
- 跨宿主复用的纯计算组件。

推荐关注：

```text
WASM Component Model
+ WIT
+ Canonical ABI
```

WASM 不适合：

- macOS Accessibility；
- Keychain；
- Apple Events；
- Windows Handle；
- PTY；
- 高频共享内存；
- 深度系统调用。

定位应是：

> 插件 ABI，而不是 Native ABI 的全面替代品。

---

## 5. Sidecar 设计

## 5.1 Sidecar 的作用

Sidecar 用于隔离：

- 不同语言 Runtime；
- 不同生命周期；
- 不同权限；
- 不同依赖体积；
- 不同失败域；
- 可独立更新的组件。

推荐进程结构：

```text
                   ┌─────────────────┐
                   │ Node Agent      │
                   │ (loop / MCP)    │
                   └────────┬────────┘
                            │ UDS / NDJSON
┌──────────────┐    ┌───────▼────────┐    ┌─────────────────┐
│ Slint UI     │◄──►│ Rust Host      │───►│ moontide-infer     │
└──────────────┘    │ Control Plane  │    │ (catalog GGUF)  │
                    └───────┬────────┘    └─────────────────┘
                            │
                   ┌────────▼────────┐
                   │ Optional Go     │
                   │ Worker          │
                   └─────────────────┘
```

所有 Runtime 默认通过 Rust Host 通信。`moontide-infer` 由 Host **supervise**（启动、健康、崩溃重启）；Node loop 经 `LLMProvider` `local-direct` preset 与其 IPC，不直连 llama.cpp。

不推荐：

```text
Node ↔ Go ↔ Rust
```

避免形成网状调用关系。

---

## 5.2 第一版 Sidecar

第一版只需要：

```text
Node Agent Runtime
```

负责：

- MCP；
- 模型 SDK；
- Agent loop；
- npm 插件；
- Provider；
- Connector。

Rust Host 负责：

- 启动；
- Handshake；
- 健康检查；
- Request / Result / Event；
- Cancel；
- Heartbeat；
- 崩溃检测；
- 自动重启；
- 权限代理；
- 进程树终止；
- Runtime 版本管理。

---

## 5.3 生命周期状态

```text
NotInstalled
→ Installing
→ Stopped
→ Starting
→ Handshaking
→ Ready
→ Busy
→ Stopping
→ Stopped
```

异常状态：

```text
Crashed
Unresponsive
Incompatible
UpdateRequired
Corrupted
PermissionDenied
```

UI 只订阅 Runtime 状态，不直接管理 PID。

---

## 5.4 启动策略

采用懒启动：

```text
App 启动
→ Slint 首屏立即出现
→ Rust Host 初始化
→ 用户首次执行 Agent 任务
→ 启动 Node Sidecar
```

Node Sidecar 启动后可在应用会话期间常驻。

浏览器 Worker、Go Worker 和其他大型 Runtime 均按需启动。

---

## 5.5 `moontide-infer` Sidecar（演进候选）

本地 LLM **不进 Node 进程、不进 WASM**。形态对齐 Kocoro `tlm`，但 MoonTide 用 **direct GGUF + llama.cpp**，不用 Ollama/vLLM 套壳。详见 [`edge-local-models.md`](../llm/edge-local-models.md)、[`kocoro-architecture.md`](kocoro-architecture.md) §6.5。

| 项 | 设计 |
|----|------|
| **语言** | Rust（`moontide-infer` crate） |
| **权重** | `~/.moontide/models/` — 仅 MoonTide catalog 签名条目 |
| **Train** | MoonTide Cloud / CI；用户 **只 pull**，不 local train |
| **IPC** | UDS + NDJSON（与 Node Agent / Rust Host 同族消息） |
| **监管** | Rust Host：懒启动、Ready/Busy、Cancel、崩溃重启 |
| **Loop 接缝** | [`runLLM.ts`](../../../packages/llm/src/pipeline/runLLM.ts) → `LLMProvider` preset `local-direct` |

**与 cloud SDK 的分工：** Node 仍持有 MCP、Composer、tool loop；infer sidecar 只做 **stateless chat completion**（+ 远期 embedding）。Model Router 在 loop 内决定 tier；local tier 走 IPC，cloud tier 走现有 HTTP adapter。

**明确不做：**

- 用户任意 URL 下载 GGUF
- 本机 fine-tune / LoRA export（v1–v2）
- 在 WASM 或 QuickJS scratch 内加载 GB 级权重

---

## 6. IPC 协议

## 6.1 第一阶段传输

推荐：

```text
NDJSON over stdin/stdout
```

原因：

- 无需端口；
- 父子进程关系明确；
- 跨平台；
- 易实现；
- 易录制；
- 易调试；
- 支持流式消息。

约定：

```text
stdout：只输出协议消息
stderr：只输出日志
```

## 6.2 基础消息类型

至少支持：

```text
hello
hello_ack
request
result
event
error
cancel
heartbeat
shutdown
capabilities
```

请求示例：

```json
{
  "type": "request",
  "id": "req-1",
  "method": "agent.run",
  "params": {
    "session_id": "session-1",
    "message": "分析这个项目"
  },
  "trace_id": "trace-1",
  "deadline_ms": 60000
}
```

事件示例：

```json
{
  "type": "event",
  "request_id": "req-1",
  "event": "message.delta",
  "data": {
    "text": "正在读取项目结构"
  }
}
```

错误示例：

```json
{
  "type": "error",
  "id": "req-1",
  "error": {
    "code": "MCP_CONNECTION_FAILED",
    "message": "Failed to connect to MCP server",
    "recoverable": true
  }
}
```

---

## 6.3 协议版本

需要分别维护：

```text
App version
Protocol version
Runtime version
Capability version
```

Handshake 示例：

```json
{
  "type": "hello",
  "protocol_version": 1,
  "runtime": "node-agent",
  "runtime_version": "0.1.0",
  "capabilities": {
    "agent.run": 1,
    "mcp.connect": 1
  }
}
```

不兼容时应在启动阶段立即失败，而不是运行到任务中间才暴露问题。

---

## 7. 权限模型

Rust Host 是唯一 Capability Broker。

Node Sidecar 默认不直接拥有：

- 完整文件系统；
- 任意子进程；
- Keychain；
- Accessibility；
- Apple Events；
- 系统设置；
- 管理员权限。

执行流程：

```text
Node 请求 Tool
→ Rust 检查 Capability
→ 检查用户授权
→ 检查 Workspace 范围
→ 执行
→ 记录审计
→ 返回结果
```

可以同时使用：

```text
Node Permission Model
+ Rust Tool Permission
+ macOS TCC / Sandbox
```

---

## 8. 性能与用户体验

## 8.1 UI 不等待 Node

启动流程：

```text
启动 Slint UI
→ 显示首屏
→ 后台检测 Runtime
→ 延迟启动 Node
```

## 8.2 流式输出批量刷新

避免每个 token 发送一次 IPC。

建议：

```text
每 16–50 ms
或累计一定字符后
批量发送 delta
```

## 8.3 大数据不走 JSON

图片、大文件、索引等应通过：

- 临时文件；
- Unix Domain Socket；
- 后续共享内存；

传输，JSON 只传元数据和路径。

## 8.4 取消与超时

```text
用户取消
→ Rust 发送 cancel
→ Node 停止模型流和 MCP
→ 超时后请求 shutdown
→ 仍无响应则 kill process tree
```

## 8.5 健康监控

Host 应监控：

- Heartbeat；
- Event loop lag；
- RSS；
- CPU；
- 当前任务数；
- stderr 错误；
- 重启次数。

---

## 9. 分发与 20 MB 目标

完整内置 Node Runtime 与“所有产品文件低于 20 MB”基本冲突。

更现实的指标是：

```text
主应用 Bundle ≤ 20 MB
完整安装体积不保证 ≤ 20 MB
```

推荐分发模式：

```text
MyAgent.app
└── Slint + Rust Host

~/Library/Application Support/MyAgent/
├── runtimes/
│   └── node-agent/
├── plugins/
├── logs/
└── cache/
```

Node Runtime 可以：

- 首次使用时按需下载；
- 独立升级；
- 独立回滚；
- 按架构分发；
- 不进入主 `.app` Bundle。

安装过程：

```text
下载
→ 校验 SHA-256
→ 验证签名
→ 解压到版本目录
→ 健康检查
→ 原子切换 current
```

---

## 10. 语言边界选择

推荐优先级：

```text
1. 独立进程 RPC
2. Node-API / napi-rs
3. WASM Component Model
4. 裸 C ABI / FFI
```

### 独立进程 RPC

默认方案，适合：

- Runtime 隔离；
- 权限隔离；
- 崩溃恢复；
- 长任务；
- 多语言集成。

### Node-API / napi-rs

只用于经过测量的热路径：

- Parser；
- Index；
- Diff；
- 压缩；
- 大量二进制数据。

### WASM

用于：

- 插件；
- 沙箱；
- 纯计算组件。

### 裸 C ABI

仅用于：

- 已有成熟原生库；
- 稳定 ABI；
- 简单数据结构；
- 多语言共同调用。

---

## 11. 推荐演进路线

### Phase 1

```text
Slint UI
+ Rust Host
+ Node Agent Sidecar
+ NDJSON IPC
```

实现：

- Runtime Manager；
- Handshake；
- Agent Run；
- Streaming；
- Cancel；
- Heartbeat；
- 权限 Broker；
- 崩溃重启。

### Phase 2

增加：

- macOS 原生权限；
- Keychain；
- Accessibility；
- Apple Events；
- Rust Native Tools；
- Runtime 下载和更新；
- **`moontide-infer` sidecar**（catalog GGUF、llama.cpp、UDS 服务）。

### Phase 2b（与 Phase 2 并行，依赖 LLMProvider Phase I）

增加：

- `moontide model pull` / catalog 校验；
- Model Router local tier → `local-direct` IPC；
- 详见 [`edge-local-models.md`](../llm/edge-local-models.md) P0–P2。

### Phase 3

增加：

- WASM 插件沙箱；
- Rust 性能模块；
- napi-rs 热路径。

### Phase 4

需求出现后再增加：

- Go Worker；
- Remote Agent；
- 多节点调度；
- 服务端控制平面。

---

## 12. 最终技术原则

```text
不选择唯一主语言。

Node.js 负责 Agent 生态和快速变化逻辑。

Rust 负责 Slint UI、宿主控制、权限、平台能力和性能模块。

Go 负责未来的长期 Worker、远程节点和调度基础设施。

WASM 负责插件隔离和纯计算扩展。

默认通过进程 RPC 集成。

只有明确性能瓶颈时才使用 FFI。

主应用保持轻量，Runtime 和插件按需安装。
```

最终目标可以概括为：

> 构建一个以原生体验为外壳、以 Node.js Agent 生态为智能层、以 Rust 为控制与系统能力层，并能按需扩展 Go Worker、WASM 插件和 `moontide-infer` 本地推理 sidecar 的多语言 Agent Desktop Runtime。

---

## 13. 相关文档

| 文档 | 关系 |
|------|------|
| [`edge-local-models.md`](../llm/edge-local-models.md) | catalog pull、`moontide-infer` 详细设计 |
| [`kocoro-architecture.md`](kocoro-architecture.md) | sidecar supervise、bundle pull 参考 |
| [`llm-provider.md`](../../archive/spec/llm-provider.md) | TypeScript 历史 `local-direct` preset、Model Router |
| [`context-composer.md`](../../archive/spec/context-composer.md) | TypeScript 历史 Composer / Session / loop 方案 |
