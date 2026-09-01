# Desktop v0.1 Chat UI State Contract

> **性质：** UI-owned projection 与 local state contract
> **状态：** D3-PF conversation projection 已实现；Session catalog 与两状态 Chat lifecycle 待实现
> **产品范围：** [`UI-V0.1-SCOPE.md`](UI-V0.1-SCOPE.md)
> **交互：** [`UI-INTERACTION.md`](UI-INTERACTION.md)
> **实现计划：** [`UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`](UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md)

## 1. 目的

前端状态分为两类：

```text
Host facts
  Desktop envelope / snapshot
       ↓
  RenderState
       ↓
  chatUiModel

Frontend-local
  draft / theme / sidebar / disclosure / reading anchor
       ────────────────────────────────┘
```

`RenderState` 是 Host facts 的可渲染 projection，不是 Agent 状态机，也不写 Session Item Log。`chatUiModel` 是 pure derivation，不发送 command。local UI state 不进入 wire、snapshot 或 Session Item Log。

页面模式只有：

```text
render.loadedSession == null → Blank Conversation
render.loadedSession != null → Loaded Conversation
```

messages length、connection state、Turn state、listing state 与 failure 均不得改变这个 page identity。

## 2. Host-owned projection

目标 `RenderState` 需要表达：

```text
RenderState
├── sessionCatalog
│   ├── status: idle | listing | ready | empty | failed
│   ├── rows
│   └── error?
├── loadedSession: SessionIdentity | null
├── session
│   └── canonical history
├── run
├── messages
├── assistantDrafts
├── tools
├── approvals
├── notices
├── delivery
└── stoppedReport?
```

其中 `run` 是当前 v1 protocol/frontend projection 的 legacy 字段名，只表示 Turn/Host 可渲染状态，不建立领域 Run。

Session catalog row 最小投影：

```text
SessionCatalogRow
├── sessionId
├── firstUserMessageExcerpt
├── lastActivityAt
└── loaded
```

约束：

- Host/catalog 决定 row 排序。
- 同时最多一个 `loaded == true`。
- `loadedSession` 与 loaded row 必须一致；不一致时 projection 进入 resync，不由 UI猜测。
- excerpt 是 derived display metadata，不是 persistent title。
- listing failure 与 empty 分开。

## 3. Frontend-local state

```text
ChatLocalState
├── draft
├── pendingPrompt?
├── firstSend
│   └── idle | startingSession | submittingTurn | awaitingFreshGeneration
├── sessionTransition
│   └── idle | closing | creatingGeneration | handshaking | loading
├── theme: white | black
├── sidebar
│   └── expanded | overlayOpen
├── expandedThinking
├── expandedTools
├── openMenu?
└── readingAnchor
    └── atBottom | detached
```

- draft 是用户尚未被 Host 接受的意图。
- theme 只持久化明确的 `white | black`。
- first-send 与 Session transition state用于去重 intent，不伪造 Host acceptance。
- local state可以 gate component interaction，但不能建立 loaded Session、Turn、approval 或 tool outcome。

## 4. chatUiModel

`chatUiModel(render, catalog, local)` 纯派生：

```text
ChatUiModel
├── page: blank | loaded
├── sidebar
├── topBar
├── conversation?
├── composer
├── notices
└── availableIntents
```

规则：

1. `page` 只读取 `loadedSession`。
2. Blank 不投影 conversation，即使旧 local cache 中存在 message。
3. Loaded 总是投影 conversation，即使 messages 为空。
4. Composer draft只读取 local state。
5. submit、new chat、load、approval 与 retry 是否可用，由 Host lifecycle、connection 与 local in-flight guard共同派生。
6. view model 不返回 bridge、command sender 或 Tauri object。

## 5. Current conversation fold

### 5.1 Assistant snapshot

收到 `AssistantResponseSnapshot`：

1. 校验当前 epoch 与严格递增 seq。
2. 以 `(turn, llm_call_id)` 查找 draft。
3. 用完整 snapshot 替换 draft，不追加 content。
4. 忽略非单调 `update_index`。
5. draft remains transient，不写 message history。

### 5.2 Assistant finalized

收到 `AssistantFinalized`：

1. 删除同 key draft。
2. 只追加一次 finalized message。
3. 重复 `(turn, llm_call_id)` 忽略。
4. 等待 authoritative Turn completion 作为整轮成功终态。

### 5.3 Tool 与 approval

- `ToolCall` 以 `tool_use_id` 建立或替换 ToolView。
- `ToolResult` 只匹配同一 ID。
- 缺少 ToolCall 的 ToolResult 请求 resync，不创建孤立 card。
- tool terminal outcome保持七类，不合并 `OutcomeUnknown`。
- `ApprovalRequested` 建立 Pending approval。
- accepted command不等于 decision 已成为新事实；event/snapshot 清除或更新 approval。
- stale/unknown/repeated decision 请求 resync。

### 5.4 Error 与 lifecycle

- `StateChanged` 更新 legacy run projection，不清空 history。
- `TurnFailed` 生成 notice并保留 error category/recoverability。
- `ResyncRequired` 设置 delivery marker。
- `Stopped` 禁 Host actions，保留 history、draft和 shutdown report。
- connection unknown不伪造 Session closed、Turn failed 或 Idle。

## 6. First-send state

Blank first Send 需要 local transaction guard：

```text
idle
  → startingSession
  → submittingTurn
  → idle
```

事实边界：

- `startingSession` 只表示 intent in flight，页面仍由 `loadedSession` 决定。
- `SessionReady` snapshot 建立 loaded identity后才能进入 `submittingTurn`。
- `TurnAccepted` 后清除本次提交对应的 draft snapshot。
- start failure保持 Blank 与 exact draft，但当前 generation 已消费/关闭；local transaction进入
  `awaitingFreshGeneration`，只有 `retryRuntime` 创建并 handshake fresh generation 后才回到 Ready idle。
- submit rejection回到 idle，保持 Loaded 与 exact draft。
- user 在 transaction 期间追加的新文本不被旧 acceptance 清除。
- 同一 transaction ID 只发送一次 StartSession 与一次 SubmitTurn。
- `SessionReady` 是 loaded identity 的接受点；`TurnAccepted` 只接受该 Session 中的首个 Turn。

如果 wire/controller 无法安全表示该状态机，必须先修改正式 contract；component 不使用 timer。

## 7. Session transition state

从 Loaded 到 Blank：

```text
idle
  → closing
  → (Stopped + ShutdownCompleted)
  → clear loaded identity
  → creatingGeneration
  → handshaking
  → idle Ready Blank
```

从 Blank 加载：

```text
idle Ready
  → loading
  → accepted snapshot
  → idle Loaded
```

规则：

- closing 期间继续显示最后一个 Loaded projection。
- shutdown failure回到 Loaded idle并保留 draft。
- shutdown 成功后旧 projection不再恢复。
- generation/handshake/load failure保持 Blank。
- generation identity与 `connection_epoch` 一致；新 generation不得复用旧 epoch。
- snapshot最终决定 catalog loaded marker与 loaded identity。

## 8. Resync

触发条件：

- event seq gap。
- 更高 `connection_epoch`。
- `ResyncRequired`。
- delivery status要求 resync。
- 用户触发 recover。

流程：

```text
request snapshot
  → queue current-epoch events
  → install snapshot baseline
  → replace Host facts
  → replay events above baseline in seq order
```

snapshot 替换：

- catalog rows与 loaded identity。
- canonical Session history。
- run、tools、approvals、delivery。
- active assistant call identities。

保留 local：

- draft/pending text。
- theme。
- Sidebar、disclosure、menu与 reading anchor（identity仍有效时）。
- first-send/transition guard只在 response correlation仍可信时保留；否则安全失败并允许用户 Retry。

`active_assistant_calls` 只证明 identity；不复制 draft content。无法证明 active 的 transient draft删除并增加 recoverable notice。重放再次 gap时停止并进入 disconnected；同一 degradation episode不发起无界 snapshot loop。

## 9. Auto-scroll projection

reading anchor 是 local state：

- 距底部在 threshold 内：`atBottom`。
- 用户向上滚离 threshold：`detached`。
- `atBottom` 时新 block/snapshot保持底部。
- `detached` 时保持 scroll position并显示 Jump to latest。
- Jump 激活后滚到底并设为 `atBottom`。
- snapshot替换尽量以稳定 message/block identity恢复 anchor；目标不存在时安全退化，不猜测 Host fact。

## 10. Theme projection

theme 不属于 RenderState：

1. 首次无持久化值时读取 `prefers-color-scheme`。
2. 映射为 `white | black`。
3. 用户选择后持久化明确值。
4. 同步 document class 与 `color-scheme`。
5. theme change不触发 Host command、snapshot或 resync。

## 11. Intent boundary

Feature component只发 typed intent：

```text
submitDraft
stopTurn
newChat
loadSession(sessionId)
retryRuntime
retryCatalog
retrySubmit
approve(approvalId)
deny(approvalId, reason)
copyMessage(messageId)
toggleTheme
toggleSidebar
jumpToLatest
```

业务 intent由 Controller处理。Copy、theme、Sidebar、disclosure和 reading anchor是 local intent；Session/Turn/approval intent通过 Controller/Host。

## 12. Invariants

1. page identity只来自 loaded Session identity。
2. loaded identity同时最多一个。
3. catalog loaded row与 loaded identity一致。
4. 一个 `AssistantDraftKey` 同时最多一个 draft。
5. finalized后不再显示同 call draft。
6. tool result没有 call时请求 resync。
7. UI draft在 Host acceptance前不进入 Session。
8. first-send重复激活不重复 command。
9. generation重建必须获得新 epoch。
10. resync替换 Host facts但保留列明 local state。
11. theme、Sidebar、disclosure与 scroll不进入 protocol。
12. connection unknown不等于业务失败。

## 13. Not RenderState

- provider SSE delta fold。
- approval decision policy。
- Session JSONL 解析/写入。
- protocol server creation与 AgentConfig ownership。
- API key、settings schema与 path canonicalization。
- multi-window、后台 Session或 scheduler。
- Terminal、File、Plan、Pins、Companion。
