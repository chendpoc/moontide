# Desktop v0.1 Session Chat Scope

> **性质：** v0.1 产品范围与实施门禁
> **状态：** Confirmed product target；目标行为不表示已经实现
> **实施计划：** [`UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`](UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md)
> **交互权威：** [`UI-INTERACTION.md`](UI-INTERACTION.md)
> **视觉方向：** [`UI-VISUAL-DIRECTION.md`](UI-VISUAL-DIRECTION.md)
> **当前 projection：** [`UI-STATE.md`](UI-STATE.md)

## 1. 产品结论

MoonTide Desktop v0.1 是单窗口、单 loaded Session、单 Agent 的 **Session Chat client**。主界面只有两种页面级视觉状态：

```text
Blank Conversation
    └── start_session { session_id } accepted / load existing Session
            ↓
Loaded Conversation
```

- `Blank Conversation`：controller projection 中没有 loaded Session。
- `Loaded Conversation`：controller projection 中有且只有一个 loaded Session。
- message 数量不决定页面状态；刚加载但没有消息的 Session 仍是 Loaded。
- connecting、listing、submitting、streaming、approval、failed、resyncing 和 disconnected 都只能在这两种页面内表达，不形成第三种页面布局。

此前确认的 Single-Agent Terminal、四区 Workbench、PTY、Content Deck、Agent Dock、File、Plan、Pins 和 Floating Island 方向不再属于 v0.1。相关文档与历史视觉资产只保留未来研究价值，不约束本版本实现。

## 2. v0.1 用户流

```text
Provider/bootstrap ready
    → Blank Conversation
    → first Send or load Recent Session
    → Loaded Conversation
    → serial Turns
```

用户可以：

- 在 Blank 页输入第一条 prompt；first-send transaction 的 `create_session` 被接受后创建 Session，
  后续 `SubmitTurn` 独立接受或拒绝。
- 从 Recent list 恢复一个 Session。
- 在 Loaded 页阅读 conversation，继续提交 Turn、取消 active Turn、处理 approval。
- 在满足 close gate 后 New Chat 或切换 Session。
- 在 White 与 Black 等价主题间切换。
- 在失败、断连或 resync 后保留 frontend-local draft。

v0.1 同时最多一个 loaded/running Session、一个 Agent 和一个 active Turn。旧 Session 不在后台运行。

## 3. 页面与空间

### 3.1 Base frame

主验收画布为 `1440 × 900`：

- Session Sidebar：默认 `240px`，可折叠。
- Main Chat Surface：占剩余宽度，最小 `560px`。
- Top Bar：`52px`。
- reading column 与 Composer：同轴，目标 `720–800px`。
- `>=1100px` 默认显示 Sidebar；更窄时 Sidebar 以 overlay 呈现。
- Tauri 主窗口建议最小宽度 `720px`。

### 3.2 Blank Conversation

- Sidebar 可显示 Recent list，但没有 row 标为 Loaded。
- 主区域只有欢迎语和 Composer，不显示 timeline、cards 或 onboarding checklist。
- Composer 在视觉中心略偏下，是唯一 primary action。
- Blank 中点击 New Chat 只清理 frontend-local draft/selection，不创建 Session。
- connection/list/runtime failure 使用 Sidebar 或 Top Bar 的 inline notice。

### 3.3 Loaded Conversation

- Sidebar 中恰好一个 row 标为 Loaded。
- Main 只显示 Conversation reading column 与底部 Composer。
- assistant 使用 plain reading surface；user 使用右对齐 compact bubble。
- thinking、tool、approval、failure、interrupted response 都是 chronology 中的 typed block。
- streaming draft 原位增长；finalized 后保持同一阅读位置。
- Composer sticky 于底部，并为 scroll content 预留遮挡空间。
- 用户离开 bottom anchor 时不强制滚动，显示 `Jump to latest`。

## 4. 所有权

- Host / Controller projection 拥有 Session catalog、loaded Session identity、runtime readiness、canonical messages、assistant drafts、tools、approvals、Turn lifecycle 与 delivery facts。
- composition root / Tauri bootstrap coordinator 拥有 runtime generation、shutdown 与 recreate；构造成功即 Ready。
- frontend-local state 只拥有 Composer draft、Sidebar 展开、theme、detail disclosure、menu 和 auto-scroll anchor。
- Session Item Log 仍是恢复事实源；Desktop protocol 是 transport contract，不是第二个事实源。
- Svelte component 只接收 view model 与 typed callback，不直接调用 bridge，也不解析 Session JSONL。

页面模式只能由 loaded Session identity 派生：

```text
loadedSession == none  → Blank Conversation
loadedSession != none  → Loaded Conversation
```

## 5. Session lifecycle

### 5.1 Session catalog

Sidebar row 至少投影：

```text
session_id
first_user_message_excerpt
last_activity_at
loaded
```

excerpt 不是持久化 title。Host 决定排序。listing、empty 和 failed 必须可区分；前端不得用 fixture 冒充生产 catalog。

### 5.2 New Chat

从 Loaded 执行 New Chat：

```text
check close gate while keeping Loaded visible
  → Shutdown current generation
  → wait for Stopped and ShutdownCompleted
  → clear loaded Session identity
  → discard old generation
  → create fresh server generation
  → Handshake to Ready Blank
```

- shutdown 确认前保留 Loaded 内容与 draft。
- active Turn、pending approval、stopping 或 unresolved delivery 阻止 New Chat。
- shutdown 失败保留最后一个 Loaded projection并显示 retry。
- shutdown 成功后，即使 fresh generation 失败也保持 Blank；不得恢复或伪造 loaded identity。
- fresh generation 必须获得新的 `connection_epoch`。

### 5.3 First Send

Blank 中第一次 Send 是 controller-owned transaction：

```text
validate exact draft
  → CreateSession exactly once
  → wait for accepted loaded Session identity
  → SubmitTurn(session_id, exact draft) exactly once
  → clear submitted draft only after Turn acceptance
```

- create failure 保持 Blank 与 exact draft。
- submit rejection 保持 Loaded identity 与 exact draft。
- Turn 接受后的模型失败保留 Session、用户消息与失败事实。
- 若失败已消费当前 generation，Retry 必须先由 composition root 创建 fresh generation，不得复用失败的 runtime。
- connection not ready 不开始 transaction。
- double activation 对同一 intent 只执行一次。
- component 不串接 Tauri invoke，也不以 timeout 猜测 Session 已 ready。

### 5.4 Load existing Session

- 从 Blank 加载：在 Ready generation 上 Start/Load，成功 snapshot 后进入 Loaded。
- 从 Loaded 切换：先按 New Chat 顺序关闭并重建 generation，再加载目标 Session。
- close gate 未满足时禁用 row switch并说明原因。
- fresh generation 或 load failure 保持 Blank；目标 row 不标为 Loaded。
- snapshot/resync 最终决定 loaded row 与 Conversation。

## 6. Conversation 与 Composer

Composer 在 Blank/Loaded 复用同一 component 与 logical draft：

- `Cmd/Ctrl+Enter` Send；普通 Enter 换行。
- IME composition 期间不 submit。
- whitespace-only 禁 Send。
- Submitting 锁定当前 submission，但允许编辑下一条 draft。
- active Turn 延续单 pending prompt contract。
- Stop 与 Send 是独立 action。

Conversation 最小 block set：

- `UserMessage`
- `AssistantMessage` / `AssistantDraft`
- `ThinkingDisclosure`
- `ToolCallBlock`
- `ApprovalBlock`
- `NoticeBlock` / `InterruptedResponse`

Tool 结果必须分别显示 `Succeeded`、`Failed`、`InvalidArguments`、`UnknownTool`、`Denied`、`Cancelled` 和 `OutcomeUnknown`。首批 message action 只包含 Copy、detail disclosure、approval Allow/Deny 与失败 Retry。

## 7. Theme 与 accessibility

- White 与 Black 是相同 geometry、spacing、font metrics 和 interaction 的等价主题。
- 首次启动可读取 `prefers-color-scheme`；之后只持久化显式 `white | black`。
- theme 是 frontend-local，不进入 RenderState、Session Item Log 或 Desktop protocol。
- active selection 使用 foreground/background、weight、shape 与 border，不使用常驻品牌 accent。
- semantic yellow/green/red 只表达 approval/success/danger。
- normal text contrast 至少 `4.5:1`；control boundary、focus ring 与 non-text state 至少 `3:1`。
- icon-only control 有 accessible name；keyboard focus 可见且顺序稳定。
- reduced motion 不影响状态可理解性。

## 8. Implementation gates

生产 UI 前必须满足：

1. 本文件、Interaction、Visual Direction、UI State 与 frontend README 只描述两状态 Chat UI。
2. 四张 reference 以稳定文件名进入 `references/chat-ui/` 并记录来源。
3. Session catalog、first-send、New Chat、load/switch 与 server generation lifecycle 有正式 contract 和测试。
4. pnpm lockfile 与当前 Svelte/shadcn 迁移收敛，不重置现有工作。
5. White/Black token 与 preference wiring 可验证。

每个 implementation batch 独立 review；未经用户 diff review 不 commit。

## 9. Acceptance

- 主界面只能识别为 Blank 或 Loaded Conversation。
- Sidebar 同时最多一个 Loaded row。
- Blank 只有一个 primary action；Loaded 只有一个内容主面。
- draft 在 start/submit/list/load/resync/disconnect failure 中不丢失。
- Session switch 不后台化旧 Agent，也不复用 consumed server。
- streaming、tool、approval、failure 和 resync 不改变页面布局。
- White/Black 等价；`1440×900`、`1280×800`、`960×720` 无关键操作裁切。
- frontend、Rust protocol、真实 Tauri smoke 与独立 Standards/Spec review 均有证据。

## 10. Non-goals

- PTY、Shell/Agent mode、Terminal Focus、Agent Terminal。
- File tree、File preview/edit、Diff review。
- Content tabs、split panes、Activity Rail、Agent Dock、Context panel。
- Floating Island / Companion。
- Plan、Pins、Task、multi-agent、多 Session 并发。
- model hub、training、image workflow、web search 产品入口。
- conversation outline、fork、regenerate、edit history、export、read aloud。
- SvelteKit、router、SSR、全局 state library、通用 design system。

## 11. 决策记录

- 2026-09-01：v0.1 从 Single-Agent Terminal 重置为两状态 Session Chat client。
- 2026-09-01：Blank 的第一次 Send 才创建 Session。
- 2026-09-01：White/Black 为等价主题，无常驻品牌 accent。
- 2026-09-01：Tool 与 Approval 保留为 Conversation inline block，不建立独立执行面。
