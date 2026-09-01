# MoonTide Desktop v0.1 Chat Interaction

> **性质：** Session Chat 行为、状态与恢复验收契约
> **状态：** Confirmed product target；目标行为不表示已经实现
> **范围：** [`UI-V0.1-SCOPE.md`](UI-V0.1-SCOPE.md)
> **视觉：** [`UI-VISUAL-DIRECTION.md`](UI-VISUAL-DIRECTION.md)
> **当前 projection：** [`UI-STATE.md`](UI-STATE.md)
> **当前 Host contract：** [`README.md`](README.md)

## 1. 产品状态

Desktop v0.1 的主界面只有两个 page mode：

```text
Blank Conversation  ← loaded Session = none
Loaded Conversation ← loaded Session = one
```

runtime、connection、listing、Turn、assistant、tool 和 approval 是 page 内子状态，不是页面。message 数量不得用于决定 Blank/Loaded。

核心不变量：

- 一个窗口最多一个 loaded/running Session、一个 Agent 和一个 active Turn。
- Session Item Log 与 Host snapshot 决定业务事实。
- composition root 拥有 protocol server generation。
- frontend 拥有 draft、theme、Session drawer 展开/宽度与 reading anchor。
- component 不直接调用 Tauri bridge，也不从 text、color、animation 或 Idle 猜测成功。

## 2. 空间与页面

### 2.1 Shared shell

两种 page mode 共享：

- Session Sidebar：New Chat、Recent、listing/error state。
- Top Bar：当前 Session excerpt 或 Blank identity、theme toggle；不放 connection badge。
- Main Chat Surface：Blank hero 或 Loaded Conversation。
- 同一个 Composer component 和 logical draft owner。

v0.1 不建立全局 Status Bar。若后续同时出现多个 window/workspace 级状态或入口，再统一放在窗口底部；
单独的 connection state 不足以创建一条永久界面区域。

Session list 始终是 Main 左侧的 docked drawer，不切换成 modal overlay。默认宽度 `240px`，允许在
`200–360px` 内水平拖拽或键盘调节；关闭后 Main 回收该宽度，再次打开恢复本次应用运行中的宽度。

### 2.2 Blank Conversation

- Recent 可非空，但没有 Loaded row。
- Main 只有 `How can I help?` 与居中 Composer。
- New Chat 只清理 local draft/selection，不启动 Session。
- runtime unavailable、list failed 或 disconnected 用 inline notice 表达。
- connection 未 Ready 时 Composer 禁用，并提供可恢复说明。

### 2.3 Loaded Conversation

- Sidebar 恰好一个 Loaded row。
- Top Bar 显示当前 Session excerpt。
- Conversation 按 chronology 渲染 message、draft、tool、approval 和 notice。
- Composer sticky 于底部。
- 一个没有 message 的 loaded Session 仍显示 Loaded page 和空 timeline。
- 初始只显示最新 30 个 whole Turns；存在更早历史时，chronology 顶部提供 `Load earlier messages`。

## 3. 状态域

### 3.1 Runtime generation

```text
creating → ready → consumed/running → stopping → stopped
```

- Ready generation 已完成内存对象构造，尚未消费 one-shot `create_session` 或
  `start_session { session_id }`。
- 首次有效 Session create/load command 无论成功或失败都会消费当前 generation。
- New Chat 或 Session switch 必须由 composition root 显式 shutdown、丢弃并创建 fresh generation。
- fresh generation 使用新的 `connection_epoch`。
- Svelte 只发送 typed intent，不创建 server。

### 3.2 Session catalog

```text
idle → listing → ready | empty | failed
```

- ready 和 empty 都允许 Blank 中 first Send。
- failed 保留上一次可信 list 时可显示 stale marker，但不得标记新 Loaded row。
- Retry 重新请求 Host/catalog；UI 不读取 Session 文件。
- Host 决定顺序；row 只格式化 timestamp，不重新排序。

### 3.3 Session selection

```text
none → starting/loading → loaded → closing → none
```

- Start/Load 只有 accepted snapshot 能建立 loaded identity。
- close 成功必须清除 identity。
- close 失败保留最后一个 Loaded projection。
- load failure 保持 Blank；candidate row 不变成 Loaded。
- snapshot/resync 可替换 loaded identity。

### 3.4 Connection

```text
connecting → ready → resyncing | degraded | disconnected
```

- 非 ready gate Host action。
- disconnected 表示权威状态未知，不等于 Turn failed 或 Session closed。
- reconnect 后由 snapshot 收敛，不以 local projection 恢复业务事实。

### 3.5 Turn

```text
Idle → Submitting → Thinking | RunningTool | WaitingApproval
     → Cancelling → Completed | Failed | Cancelled
```

- 第二个 active Turn 不排队。
- active Turn 期间最多一条 pending prompt。
- Stop 与 Send/Queue 分离。
- Completed 必须来自 authoritative event/snapshot，不从 assistant finalized 推断。

### 3.6 Assistant、tool 与 approval

- assistant：`none → Draft → Finalized | Interrupted`。
- draft 以 `(turn, llm_call_id)` 原位替换。
- tool 从 active 收敛到七种 terminal outcome 之一。
- approval：`Pending → Resolving → Resolved | Stale`。
- 同一 approval 只有一个 inline actionable owner。

## 4. First Send

Blank 第一次 Send 由 Controller 原子编排：

```text
validate draft
  → mark first-send intent in flight
  → CreateSession once
  → wait for accepted loaded identity
  → SubmitTurn(session_id, exact draft) once
  → clear submitted draft after Turn acceptance
```

规则：

1. whitespace-only 不开始。
2. connection/generation 未 Ready 不开始。
3. intent in flight 时重复 click/shortcut 无效。
4. create rejection 或 transport failure：仍是 Blank，恢复 exact draft；若该 generation
   已被消费/关闭，进入 runtime unavailable，直到 Retry 创建 fresh generation。
5. create accepted、submit rejected：保持 Loaded 与 exact draft。
6. submit accepted 后只清除已提交文本；用户在 in-flight 期间新输入的内容不被清除。
7. Turn 接受后的模型失败保留新 Session、用户消息与失败事实。
8. resync 期间暂停 sequence；只有 authoritative snapshot 能决定继续或失败。
9. component 不等待 timeout，也不自行串接多条 bridge command。

## 5. New Chat 与 Session switch

### 5.1 Close gate

以下任一条件存在时，New Chat 与 row switch 禁用并说明原因：

- active Turn 或 Cancelling。
- pending approval。
- stopping lifecycle。
- unresolved delivery/resync。
- connection state unknown。

同一 gate 也约束 `Load earlier messages`：active Turn、pending approval、resync、connection unknown 或
Session lifecycle intent 期间按钮保持可见但 disabled，并在按钮附近说明原因。历史加载本身 single-flight；
失败保留当前 messages，显示 retryable error。

### 5.2 New Chat from Loaded

```text
keep Loaded visible and preserve draft
  → request Shutdown
  → observe Stopped
  → receive ShutdownCompleted
  → clear loaded identity, enter Blank
  → discard old generation
  → create fresh generation
```

- shutdown rejection/failure：保留最后 Loaded projection 与 draft 作为证据，等待显式 runtime retry。
- shutdown 成功后不回滚到旧 Loaded。
- fresh creation failure：保持 Blank，显示 Retry，Composer disabled。
- retry 只创建新的 generation，不复用 stopped handle。

### 5.3 New Chat from Blank

只清理 local draft 与 candidate selection，不创建 Session，不重建尚可用的 Ready generation。

### 5.4 Load existing

从 Blank：

```text
select candidate
  → start_session { session_id }
  → accepted snapshot establishes Loaded
```

从 Loaded：

```text
close current generation
  → enter Blank
  → create fresh generation
  → start_session { session_id }
  → accepted snapshot establishes target Loaded
```

任何 load failure 都保持 Blank 与 catalog candidate；不得恢复旧 runtime、伪造目标 Loaded 或删除旧 Session Item Log。

## 6. Composer

- Blank 与 Loaded 使用同一 `Composer.svelte`。
- `Cmd/Ctrl+Enter` Send；普通 Enter 插入换行。
- IME composition 期间 Enter chord 不 submit。
- empty/whitespace-only 禁 Send。
- Submitting 锁定当前 submission，不锁定后续 draft 编辑。
- active Turn 中 Send 变为明确的 Queue/Update Pending，不隐藏 Stop。
- submission rejection 恢复 exact text。
- draft 在 theme、Sidebar、resync、disconnect 和 page placement 改变时保留。
- attachment、permission 和 model controls 只有存在真实 intent/contract 后才显示。

## 7. Conversation

chronology 内可出现：

- user message。
- assistant finalized message。
- assistant streaming draft。
- thinking disclosure。
- tool call 与 terminal outcome。
- approval decision block。
- failure、connection、resync 与 interrupted notice。

展示规则：

- assistant 使用 plain reading surface。
- user 使用右对齐 compact bubble，长 prompt 仍保持可读宽度。
- thinking/tool detail 可折叠，状态摘要始终可见。
- raw tool content 只在 detail 中显示；secret 不进入可复制 notice。
- `OutcomeUnknown` 必须明确写“执行结果未知”，不得并入 Failed。
- approval stale 后按钮立即不可执行，并请求/等待 snapshot 收敛。
- failure/cancel partial 只作为 local Interrupted response，不写 Session Item Log。

首批 message actions：

- Copy user/assistant text。
- expand/collapse thinking/tool。
- Allow/Deny approval。
- Retry connection/list/submit failure。

Regenerate、Edit、Fork、Export、Read aloud 和 Delete 不显示。

## 8. Streaming 与 reading anchor

- 相同 `(turn, llm_call_id)` 的 snapshot 替换同一个 draft。
- 用户位于 bottom threshold 内时，新内容维持 bottom anchor。
- 用户离开 threshold 后，stream update 不改变 scroll position。
- 非 bottom 时显示 `Jump to latest`；激活后滚到底并恢复 anchor。
- finalized 不创建第二个视觉 message，也不跳动 reading position。
- snapshot/history/replay 不触发 live-only sound 或 announcement。
- older history 使用 exclusive Turn cursor 按 whole Turn prepend；加载中显示明确 spinner，完成后保持原可见内容的位置。

## 9. Theme

- Theme control 在 White/Black 间切换。
- 首次没有 preference 时读取 `prefers-color-scheme`。
- 用户明确选择后只持久化 `white | black`。
- 应用 class、`color-scheme` 与 local preference 同步。
- theme 切换不改变 layout、draft、selection、scroll 或 Host state。

## 10. Keyboard、focus 与 layers

### 10.1 Shortcuts

- Composer `Cmd/Ctrl+Enter`：Send 或 Queue。
- active Turn `Cmd/Ctrl+.`：Stop。
- `Esc`：先关闭当前 local layer；不 Stop、不 New Chat。Session drawer 不是 layer，因此不由 `Esc` 关闭。
- Session drawer resize handle：`←` / `→` 每次调整 `16px`，`Home` / `End` 到最小/最大宽度。
- Tab 顺序：Session drawer → Top Bar → chronology controls → Composer。

### 10.2 Focus

- icon-only control 有 accessible name；tooltip 不是唯一 label。
- dynamic row、stream update 与 notice 不抢 focus。
- opening approval Review 聚焦 heading，不直接聚焦 Allow。
- resolving action 保留可理解的 disabled/busy state。
- New Chat/Session switch 完成后，Blank Composer 或 Loaded heading 获得合理焦点。
- theme toggle、copy result 和 connection changes通过适当 live region 宣告，不重复播报 stream token。

### 10.3 Layer precedence

1. approval deny detail。
2. row/message dropdown。
3. no-op。

## 11. Resync 与恢复

resync 保留 frontend-local：

- current Composer draft 与 pending/held text。
- theme preference。
- Session drawer open/width state。
- expanded thinking/tool detail。
- message menu 与 reading anchor（目标消失时安全关闭/重置）。
- local Interrupted response。

snapshot 替换 Host facts：

- Session catalog 与 loaded identity。
- canonical messages。
- active assistant call identities。
- tools、approvals、Turn lifecycle 与 delivery。

若 snapshot 无法证明 draft 仍 active，删除 transient draft，不把这次 cleanup 当成用户失败。进行中的 delivery resync 才显示恢复 notice；connection 已 degraded/disconnected 时不叠 resync notice。connection/catalog/history/action/notice 的用户文案由 projection 映射，Host message 不进聊天表面。事件 replay 只发生在 snapshot baseline 安装后；gap 再现时进入 disconnected，不无界重试。

## 12. Responsive behavior

- `1440×900`：Session drawer 默认 `240px`，Main 读取列 `720–800px`。
- `1280×800`：保持 docked drawer 与可读列。
- `960×720`：Session drawer 仍与 Main 并排；不创建遮罩、focus trap 或 modal layer。
- `200%` zoom 等效宽度至少 `720px` 时，critical action 不水平裁切。
- sticky Composer 不遮挡最后一个 block；scroll padding 与 Composer 实际高度同步。

## 13. Accessibility gates

- normal text contrast ≥ `4.5:1`。
- control boundary、focus ring 与 non-text state ≥ `3:1`。
- status 同时使用 text 与 shape/icon，不只用 color。
- touch/click target 至少 `32×32`，primary target 目标 `40×40`。
- reduced motion 移除非必要 transition/scroll animation。
- listing skeleton 有 bounded duration；错误出现后 skeleton 退出。
- ApprovalRequested 只对 live event 宣告一次。
- secret、authorization header 与敏感 tool input 不进入 notice、clipboard status 或 accessible name。

## 14. Acceptance scenarios

1. Blank、Recent list 与 Ready Composer 可同时存在，没有 Loaded row。
2. first Send create/accept failure 保留 exact draft且不建立 loaded identity。
3. first Send 已接受后的模型失败保留 Session 与用户消息。
4. double activation 只产生一次 CreateSession 与一次 SubmitTurn。
5. New Chat 在 shutdown 前保留 Loaded；成功后进入 Blank并获得 fresh epoch。
6. Session switch close/load failure 不伪造 target Loaded。
7. 空 loaded Session 仍是 Loaded page。
8. streaming 原位增长，离开 bottom 时不强制滚动。
9. 七种 tool outcome、approval stale、failure/cancel 均不改变 page layout。
10. resync 替换 Host facts但保留 local draft/theme。
11. White/Black geometry 等价。
12. keyboard、IME、focus、live announcement 和 Session drawer 拉伸/折叠可复现。

## 15. Non-goals

- Agent Terminal、PTY、Shell/Agent Mode、control handoff。
- Activity Rail、Content Deck、Agent Dock、Floating Island。
- File、Plan、Pins、Task、multi-agent。
- 多 Session 并发或后台 runtime。
- Regenerate、Fork、Edit history、Export、Read aloud。
- 从 UI fixture、timeout 或文本推断 Host fact。
