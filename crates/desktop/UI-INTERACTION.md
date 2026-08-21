# MoonTide Desktop UI Interaction

> **性质：** v0.1 UI 与交互验收契约
> **依赖：** [`README.md`](README.md)、[`DESIGN.md`](DESIGN.md)、[`UI-STATE.md`](UI-STATE.md)
> **状态：** v0.1 baseline；Iced 已确认，D3-R2 最小 shell 已实现，完整 D3 UI 尚未完成

## 1. 产品交互方向

Desktop v0.1 采用“对话中心的轻量 Workbench”而不是纯聊天窗口或完整 IDE：

- 对话是主任务区，用户始终能看到当前目标和最终结果；
- Session 导航放在左侧，支持创建、恢复和切换；
- Tool、Approval、Thinking 和诊断详情放在可折叠的右侧 Inspector；
- 一个窗口只运行一个活跃 Session 和一个活跃 Turn；
- v0.1 不提供后台任务队列、多窗口和多 Agent 面板。

### 1.1 方案取舍

| 方案 | 优点 | 不采用的原因 |
|---|---|---|
| 纯对话 | 学习成本低，视觉简单 | Tool、approval、恢复状态不够可观察 |
| IDE Workbench | 工具详情、Session 和诊断能力完整 | v0.1 面板过多，容易把 Agent 变成普通 IDE |
| 对话中心 Workbench | 保持对话主线，同时提供可展开的执行详情 | 需要明确面板打开/关闭和状态同步规则 |

最终采用第三种方案。

## 2. 窗口结构

```text
┌──────────────────────────────────────────────────────────────┐
│ Top Bar: workspace · session title · run state · settings     │
├──────────────┬───────────────────────────────┬───────────────┤
│ Session Rail │ Conversation                  │ Inspector     │
│              │                               │               │
│ New          │ user message                  │ Tool detail   │
│ Recent       │ assistant final/draft         │ Approval      │
│ Search       │ tool cards                    │ Thinking      │
│              │                               │ Diagnostics   │
│              ├───────────────────────────────┤               │
│              │ Composer + send/stop           │               │
└──────────────┴───────────────────────────────┴───────────────┘
```

### 2.1 Top Bar

显示：

- 当前 workspace 名称和路径缩写；
- 当前 Session 标题及恢复状态；
- `Idle`、`Thinking`、`Running tool`、`Waiting approval`、`Cancelling`、`Error`；
- Settings 入口；
- Inspector 开关。

Top Bar 的状态来自 `DesktopRunState`，不从最后一条文本推断运行状态。

### 2.2 Session Rail

功能：

- `New session` 创建新 Session；
- 最近 Session 列表显示标题、最近 Turn 时间和工作目录；
- 点击 Session 在 `Idle` 时切换；
- 运行中点击其他 Session，显示“当前 Turn 正在运行”，不直接切换；
- Session 列表加载失败显示局部错误，不清空当前 Conversation。

v0.1 不提供 Session tab、多 Session 同时运行和后台 Session notification。

### 2.3 Conversation

Conversation 是唯一默认展开的主要区域，按时间顺序显示：

- User message；
- Assistant finalized message；
- 当前 Assistant draft；
- Tool card 的简略状态；
- 可恢复错误 notice。

历史消息来自 `SessionSnapshot`。运行中 draft 当前来自 `DesktopMessageEnvelope` 中的
`DesktopProtocolEvent`；不能在 resync
时误写成已完成历史。

### 2.4 Inspector

Inspector 默认收起，打开后显示当前选中对象：

- Tool：名称、参数、工作目录、状态、结果；
- Approval：待决策工具、参数摘要、允许/拒绝操作；
- Thinking：当前 draft 中的 thinking blocks，默认折叠；
- Diagnostics：Progress/Agent Event Log 状态、resync marker 和最近错误。

Inspector 关闭不影响 Agent 运行，也不改变 approval 决策。等待 approval 时如果
Inspector 被关闭，Top Bar 和 Conversation 仍显示明显的 pending 标记。

### 2.5 Composer

Composer 固定在 Conversation 底部：

- 多行文本输入；
- Send 按钮；
- active Turn 时切换为 Stop；
- 发送失败时保留未提交输入；
- 空输入不可发送；
- `Cmd/Ctrl+Enter` 发送，`Esc` 取消 active Turn 或关闭当前 Inspector。

## 3. 核心交互状态

### 3.1 Composer 状态

| 状态 | 输入 | 主按钮 | 说明 |
|---|---|---|---|
| Idle | 可编辑 | Send | 可以提交新 Turn |
| Submitting | 禁止编辑或保留编辑 | Loading | 等待 host 接受命令 |
| Thinking | 默认只读 | Stop | assistant draft 持续替换 |
| Running tool | 默认只读 | Stop | Inspector 显示工具状态 |
| Waiting approval | 默认只读 | Stop | Approval card 可操作 |
| Cancelling | 禁止操作 | Cancelling | 等待 AgentLoop cleanup |
| Failed | 可编辑 | Send | 错误可复制、可继续下一 Turn |
| Stopped | 禁止操作 | Disabled | 需要重新启动 Desktop |

`Busy` 不等于排队：第二次 Submit 直接返回 host error，UI 保留输入内容并显示
“当前 Turn 正在运行”。

### 3.2 Assistant draft

1. 收到第一条 `AssistantResponseSnapshot` 时创建一个 draft bubble；
2. 后续 snapshot 按 `(turn, llm_call_id)` 完整替换；
3. 文本、thinking、pending block 在同一 bubble 内分区显示；
4. 普通文本默认展开，thinking 默认折叠；
5. 收到 `AssistantFinalized` 后移除 draft，写入 finalized message；
6. 收到 `TurnCompleted` 后结束 loading；
7. 收到 `TurnFailed` 时保留最后一个 draft 作为“未完成响应”并标记错误，不伪装成最终消息。

用户看到的是同一个 assistant bubble 的实时增长，而不是多条重复消息：

```text
Hel
Hello
Hello, wor
Hello, world
```

### 3.3 Tool card

Tool card 的状态固定为：

```text
Discovered → Waiting approval → Approved → Running → Succeeded
                                      ├──────► Denied
                                      ├──────► Failed
                                      ├──────► Unknown
                                      └──────► Cancelled
```

规则：

- `Allow` 工具跳过 Approval card，直接显示 Running；
- `Ask` 工具必须显示 Approval card，不能通过 UI 默认自动批准；
- Tool card 默认显示名称和简短状态，参数/结果在 Inspector 展开；
- `Denied`、预期失败、`OutcomeUnknown` 和 `Cancelled` 使用不同状态文案；
- `OutcomeUnknown` 明确提示“执行结果未知”，不能显示为成功或普通失败；
- ToolResult 到达后，Tool card 才允许进入终态。

## 4. Approval 交互

Approval 是阻塞式用户决策，但不阻塞 UI 线程：

```text
Agent emits ApprovalRequested
  → Host state = WaitingApproval
  → Top Bar + Conversation + Inspector show pending
  → user chooses Allow / Deny
  → Host resolves ApprovalId
  → Tool continues or returns denied result
```

Approval card 必须显示：

- 工具名称；
- 参数摘要，长内容可展开；
- 工作目录；
- Allow；
- Deny；
- 可选的拒绝原因输入。

重复点击同一个 decision 显示“请求已处理”，不重复执行工具。窗口关闭或点击 Stop
时，pending approval 统一取消，不默认批准。

## 5. Cancel 交互

用户点击 Stop 后：

1. 按钮立即变为 Cancelling；
2. Host 触发当前 Turn 的 `CancellationToken`；
3. UI 禁止新的 Submit 和 approval decision；
4. 等待 AgentLoop 完成 tool/result 配对和 cleanup；
5. 收到 `TurnFailed { kind: Cancelled }` 后回到可继续的 Failed/Idle；
6. 输入框恢复可编辑，原未提交输入保留。

Stop 不通过丢弃 future 实现。UI 不自行删除 Tool card 或猜测 Session 是否已完成。

## 6. 错误和恢复

### 6.1 错误展示

错误 notice 必须包含：

- 简短标题；
- 可读错误描述；
- 错误类别：Configuration、Provider、Tool、Approval、Cancelled、Persistence、Internal；
- Copy error 操作；
- 可恢复时显示 Continue / Retry 的明确动作。

API key、完整 authorization header 和敏感配置不得出现在 notice、Progress 或诊断面板。

### 6.2 Resync

发现 event seq gap、Progress `resync_required` 或 worker degraded 时：

1. 顶部显示非阻塞的“状态需要同步”提示；
2. 保留用户正在编辑的输入和 UI 面板偏好；
3. 调用 `DesktopHostHandle::snapshot()`；
4. 以 Session history 替换已完成消息，以 host state 替换运行状态和 pending approval；
5. 删除无法证明仍属于 active call 的 draft；
6. 完成后清除提示，并继续消费后续事件。

Resync 不是重新执行 Turn，也不是从 Agent Event Log 恢复事实。

## 7. Session 恢复流程

```text
Open Desktop
  → resolve workspace/settings
  → list sessions
  → choose New or Existing
  → load SessionSnapshot
  → construct Agent::create/resume
  → show conversation
  → enable Composer
```

如果 Session load 失败：

- 保留 Session Rail；
- 在主区域显示可复制错误；
- 不创建一个同名新 Session 覆盖旧状态；
- 用户必须明确选择 New session 或 Retry load。

Session 切换只允许发生在 `Idle`。v0.1 不做强制中断后自动切换。

## 8. Settings 交互

Settings 作为独立 modal/page，不覆盖 Conversation：

- Provider family、base URL、model；
- API key；
- tool permission；
- Session persistence 和 diagnostic persistence；
- thinking 展示偏好；
- workspace 路径。

保存流程：

```text
edit → validate locally → write .moontide/settings.json atomically
     → if runtime-affecting, reload only when Idle
     → show applied / failed result
```

API key 可按既定产品决策持久化在用户设备上，但永不写入 Session Item Log 或 Agent
Event Log。运行中修改影响当前 Agent 的设置时，UI 必须明确显示“将在当前 Turn 完成后
生效”或要求用户先停止运行。

## 9. 视觉与可访问性基线

v0.1 采用稳定、低干扰的开发者工作台风格：

- light/dark 两套主题，跟随系统并允许用户覆盖；
- 系统无衬线字体，正文优先可读性；
- 颜色不是唯一状态信号，状态同时显示文字和图标；
- approval、error、cancellation 使用清晰但克制的强调色；
- 流式更新只使用轻微 opacity/cursor 变化，不使用阻塞式动画；
- 所有核心操作可用键盘完成；
- focus ring、最小对比度和可调整字号由 Iced view state 与组件样式保持一致；
- 不把透明、虚化、多窗口和复杂动效作为 v0.1 交付条件。

## 10. D3 UI 验收场景

1. 新建 Session，发送文本，看到同一个 assistant bubble 流式增长；
2. Allow 工具，看到 Tool card 从 Running 到 Succeeded；
3. Ask 工具，看到 Approval card，Deny 后模型收到 denied result；
4. 在 Thinking、Running tool、Waiting approval 三种状态点击 Stop，均能回到可继续状态；
5. provider 错误可见且不会清空已有 Conversation；
6. 模拟 Progress 丢失，显示 resync 提示并恢复历史与运行状态；
7. 关闭并重新打开 Desktop，能选择旧 Session 并继续下一 Turn；
8. macOS、Windows、Linux 上核心布局、快捷键语义和 settings 保存行为一致。

## 11. 后置交互

以下不进入 v0.1：

- 多 Session 并发和后台任务中心；
- Session fork、diff、文件树和代码编辑器；
- Fleet、Tide、Buoy 等多 Agent/观测面板；
- 多窗口布局、跨设备同步和远程连接。
