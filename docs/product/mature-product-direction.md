# MoonTide 成熟产品方向：Remote Compute & Model Runtime

> **性质：** Mature product direction
> **状态：** Proposal；远程计算与自托管模型能力已纳入成熟产品方向，尚不属于 Desktop Shell v0.1 的实现承诺。
> **范围：** Provider、远程模型 endpoint、SSH 运行时、GPU 租赁和未来 Remote Agent Worker
> **当前 MVP 边界：** [`plan.md`](plan.md) · [`desktop-development-direction.md`](desktop-development-direction.md)

## 1. 产品判断

MoonTide 的成熟产品不应只提供「本地 Agent + 云端 API」这一种模型使用方式，还应允许用户租赁云端 GPU，部署自己选择的开源模型，并获得接近本地部署的使用体验。

用户可以按 GPU 租赁时长付费，而不是按每次模型请求的 token 付费。这里的产品承诺不是字面意义上的“无限 token”，而是：

> 用户控制模型运行时和模型权重；MoonTide 不为模型 token 增加按量 API 计费。

实际限制仍包括上下文窗口、单次输出上限、GPU 在线时长、存储、网络、provider 配额和远程服务吞吐。

典型场景：用户租赁带有目标 GPU 的云主机，通过 SSH 连接远程机器，在机器上运行 Qwen 等开源模型的推理服务，MoonTide 本地继续负责 Agent、工具、Session、审批和 UI。

## 2. 参考流程：Provider 与 Model 解耦

OpenCode 的可复用设计是：Provider 负责连接和认证，Model 负责模型标识与能力，Agent 只消费统一的模型接口。自定义 OpenAI-compatible endpoint 也可以通过 Provider 配置接入；模型的 context/output limit 需要显式声明，因为客户端不能可靠推断远程服务的真实限制。

参考：

- [OpenCode Providers](https://opencode.ai/docs/providers)
- [OpenCode Models](https://opencode.ai/docs/models)
- [Lightning AI Virtual Machines](https://lightning.ai/docs/platform/gpu-cloud/virtual-machines)
- [Lightning AI SSH access](https://lightning.ai/docs/overview/ai-studio/ssh-access)

MoonTide 应沿用相同的核心路径：

```text
ProviderProfile + ModelProfile
        ↓
可访问的 ModelEndpoint
        ↓
agent-core::llm::LLMProvider
        ↓
AgentLoop / Session / Tools
```

模型运行在本机、远程 HTTPS 服务还是 SSH 隧道后面，不应改变 AgentLoop 的 Turn、Tool round、Session 和 approval 语义。

## 3. 运行模式

### 3.1 本地 Agent + 远程模型

第一阶段的默认模式：

```text
本地 UI / CLI
  → 本地 AgentLoop
  → 本地工具与 Workspace
  → SSH tunnel / HTTPS
  → 远程 GPU Model Server
```

优点：

- 对现有 AgentLoop 改动最小；
- 工具仍在本地执行，权限边界清晰；
- Session Item Log 仍由本地 SessionStore 负责；
- 远程 GPU 只承担模型推理；
- 可以先支持用户手动启动的远程模型服务。

代价：

- 代码和上下文可能通过网络发送到远程模型；
- 需要处理 SSH 断线、端口变化和模型服务未就绪；
- 远程 GPU 不能直接访问本地文件系统。

### 3.2 本地 UI + 远程 Agent Worker

后续模式：

```text
本地 Desktop
  → Runtime Host / SSH
  → 远程 Agent Worker
      ├── AgentLoop
      ├── AgentTools
      ├── Workspace
      └── Model Server
```

适合长时间任务、后台运行、大型项目和本地资源不足的场景。它需要新增远程任务生命周期、Workspace 同步、断线恢复、权限传递和协议版本，不应作为第一阶段的前置条件。

### 3.3 本地与远程 Workspace

成熟产品需要让用户明确选择代码位置：

- 代码保留本地，只把请求发送到远程模型；
- 将当前 Workspace 上传到远程机器；
- 远程机器从 Git checkout；
- 完全在远程 Workspace 中运行 Agent。

不同模式对应不同的隐私、同步、网络和恢复语义，不能在 UI 中隐藏成同一种操作。

## 4. 分层与 owner

### 4.1 `agent-core::llm`

继续负责：

- `ModelRequest` / `ModelResponse`；
- provider-neutral protocol；
- streaming、tool calling、thinking 和 response normalization；
- 对最终 endpoint 的协议调用。

不负责：

- SSH；
- GPU VM 创建与释放；
- 模型下载和启动；
- 云厂商 API；
- 租赁预算和自动停机。

### 4.2 `agent` / Provider 配置层

负责把用户选择解析为显式的 `ProviderProfile`、`ModelProfile` 和最终 `ModelEndpoint`，并将它们装配给 `LLMProvider`。

### 4.3 Remote Runtime 层

负责：

- SSH 连接和本地端口转发；
- 远程机器状态；
- 模型服务启动、停止和 health check；
- provider API 生命周期；
- 断线重连和异常清理；
- GPU 租赁预算与 idle policy。

Remote Runtime 不拥有 Session Item Log，不决定 Tool permission，不复制 AgentLoop。

## 5. 核心产品对象

### ProviderProfile

描述如何连接一个模型服务：

```text
provider_id
display_name
protocol_family
base_url
auth_ref
custom_headers
runtime_kind
```

`runtime_kind` 可区分：

```text
local_process
direct_https
ssh_tunnel
managed_gpu
remote_worker
```

### ModelProfile

描述一个可选择的模型：

```text
provider_id
model_id
display_name
context_limit
output_limit
supports_streaming
supports_tools
supports_reasoning
supports_parallel_tool_calls
quantization
runtime_backend
```

产品不能把 Qwen 某个版本写死为特殊分支。不同模型、量化方式、推理后端和 GPU 配置都应通过 profile 表达。

### RemoteRuntimeProfile

描述如何准备远程运行环境：

```text
provider
machine_id or machine_spec
ssh_host
ssh_port
ssh_user
ssh_key_ref
remote_workspace
model_artifact
startup_command
health_check
```

### GpuLease

描述一段可计费的远程 GPU 租赁：

```text
lease_id
provider
machine_id
gpu_profile
state
started_at
last_activity_at
idle_timeout
max_budget
```

`GpuLease` 是资源生命周期对象，不是 Session，也不是 Agent Run。它负责回答“机器是否正在产生费用、何时可以安全释放”。

## 6. 远程模型生命周期

```text
Configured
  → Provisioning
  → Booting
  → Connecting
  → Installing
  → StartingModel
  → Ready
  → Serving
  → Idle
  → Stopping
  → Released
```

异常状态必须可观察并可恢复：

- provider 创建失败；
- SSH host key 不匹配；
- SSH 连接断开；
- GPU 不符合 ModelProfile；
- 模型下载中断；
- 推理服务 health check 失败；
- VM 被抢占或意外停止；
- MoonTide 进程崩溃后遗留租赁。

默认策略应偏向成本安全：空闲自动停止、预算上限、启动失败自动清理、关闭应用时提示并处理仍存活的租赁。

## 7. 安全与数据边界

- provider API key、SSH private key 和远程服务 token 使用独立 credential store，不写入 Session Item Log、Agent Event Log 或 prompt；
- 首次连接必须校验并持久化 SSH host key，禁止静默接受变化；
- SSH 用户应为受限用户，远程目录和进程权限按最小权限配置；
- 代码上传、Git checkout 和纯 prompt 远程推理必须由用户明确选择；
- 远程机器不应默认获得本地 Workspace 的无限读写权限；
- sidecar/MCP 的进程隔离不能被 SSH 隧道或普通 IPC 视为安全边界；真正的第三方执行仍需要 OS sandbox、受限身份或 capability 控制；
- remote worker 的审批请求必须回到本地 UI，并且不能绕过本地 permission policy。

## 8. 分阶段路线

### Remote Model Endpoint R1

先支持手动准备好的 OpenAI-compatible endpoint：

- ProviderProfile；
- ModelProfile；
- 自定义 base URL；
- 显式 context/output limit；
- streaming/tool calling 能力声明；
- API key 独立存储；
- 不实现 GPU 租赁自动化。

验收：本地 AgentLoop 能以不改 Turn/Session/Tool 语义的方式调用远程自部署模型。

### SSH Runtime R2

- SSH key 与 host key 管理；
- 本地端口转发；
- 远程模型服务启动命令；
- readiness/health check；
- 断线重连；
- 关闭时清理 tunnel；
- 手动释放远程服务。

验收：用户可以从 MoonTide 选择一个已存在的 GPU 机器，建立 SSH 通道并完成一轮真实模型调用。

### Managed GPU R3

- provider adapter；
- GPU machine 查询与选择；
- VM 创建、启动、停止和销毁；
- 模型权重缓存；
- GpuLease；
- idle timeout；
- max budget；
- 租赁状态恢复。

验收：启动失败、断线、取消和应用崩溃后，不留下不可发现或无限计费的远程资源。

### Remote Agent Worker R4

- 远程 AgentLoop；
- 远程 Workspace；
- 后台任务；
- 本地 UI attach/detach；
- 断线后继续任务；
- 任务事件和权限协议；
- Workspace 同步或远程 Git 工作流。

该阶段才需要 Runtime Host、Worker、IPC 和更完整的任务生命周期，不提前作为 R1–R3 的实现依赖。

## 9. 非目标

当前不因为该方向而：

- 在 `agent-core` 中加入 SSH 或云厂商 SDK；
- 把 Lightning AI 写成唯一 provider；
- 把某个具体模型写成特殊内置能力；
- 直接实现远程多 Agent 或 scheduler；
- 把“无 token 计费”宣传成真正无限上下文或无限输出；
- 让 Desktop 直接解析远程机器状态或 Session JSONL；
- 在没有预算和释放策略前自动创建计费 GPU。

## 10. 与当前路线的关系

该方向属于成熟产品路线，不改变当前 Desktop Shell v0.1 的单窗口、单活跃 Session、Turn 串行边界。

当前执行顺序仍是：

1. Desktop 本地宿主能力收口；
2. ProviderProfile / ModelProfile 与自定义 endpoint；
3. SSH 远程模型通道；
4. GPU 租赁生命周期；
5. Remote Agent Worker 与后台任务。

Remote Compute 的第一条产品验收路径是“本地 MoonTide Agent 调用远程自部署模型”，不是“先做完整云平台”。
