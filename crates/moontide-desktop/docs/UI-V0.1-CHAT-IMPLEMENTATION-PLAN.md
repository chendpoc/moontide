# MoonTide Desktop v0.1 Chat UI Implementation Plan

> **状态：** Confirmed；Batch 0-5 已完成，Batch 6A 与 Batch 7 已实现并通过独立 review，Batch 6B 待执行
> **版本目标：** v0.1 post-bootstrap primary surface
> **技术栈：** Tauri 2 · Svelte 5 · TypeScript · Vite SPA · shadcn-svelte · Tailwind CSS v4
> **视觉参考：** 用户于 2026-09-01 提供的 Unsloth blank/loaded Chat 与 DeepSeek blank/loaded Chat 截图
> **交付进度：** Batch 0-5 已按本计划落地；Batch 6 已拆为 6A interaction/accessibility 与 6B real-window visual QA；插入的 Batch 7 Session switching/history performance 已实现，下一步回到 6B

## 1. 结论

MoonTide Desktop v0.1 的主界面收敛为一个 **Session Chat client**，只存在两种页面级视觉状态：

```text
Blank Conversation
    └── start_session { session_id } accepted / load existing Session
            ↓
Loaded Conversation
```

1. **Blank Conversation**：没有 loaded Session。左侧显示 Session navigation，主区域只显示欢迎语与居中 Composer。
2. **Loaded Conversation**：存在唯一 loaded Session。左侧标记当前 Session，主区域显示 Conversation reading column 与底部 Composer。

`connecting`、`listing`、`submitting`、`streaming`、`waiting approval`、`failed`、`resyncing` 和
`disconnected` 仍然是必要的业务或交互子状态，但只能作为两种页面状态中的 row、notice、message block、
button state 或 skeleton 表达，不得扩展成第三种 Workbench/page layout。

这是一项 v0.1 范围重置。现有 `Single-Agent Terminal` 四区、Content Deck、Agent Dock、File、Plan、Pins、
Floating Island 和 PTY 设计不进入本计划。它们可以保留为未来产品研究，但不得继续约束 v0.1 实现。

## 2. Source of truth 与实施门禁

### 2.1 权威顺序

本计划已获批，v0.1 UI 的权威顺序为：

1. 本计划确认的两状态产品范围；
2. 修订后的 `UI-V0.1-SCOPE.md` 与 `UI-INTERACTION.md`；
3. `UI-STATE.md` 的当前 protocol projection；
4. `README.md` / `DESIGN.md` 的 Host 与 transport ownership；
5. 用户提供的 Unsloth / DeepSeek App UI 截图作为视觉参考。

进入视觉实现前，四张 reference 必须以稳定文件名存入
`crates/moontide-desktop/docs/references/chat-ui/`：`unsloth-blank.png`、`unsloth-loaded.png`、
`deepseek-blank.png`、`deepseek-loaded.png`，并在同目录 README 记录来源、捕获日期、仅供内部设计参考及
对应的 Blank/Loaded 状态。聊天附件本身不是可复现的验收输入。

截图只决定空间、密度和交互表达，不改变 MoonTide 的 Host、Session Item Log、approval、event ordering 或
failure semantics。

### 2.2 Hard Blockers

进入生产代码前必须解决：

- **文档冲突（Batch 0 初始状态）：** `UI-V0.1-SCOPE.md`、`UI-INTERACTION.md`、
  `UI-VISUAL-DIRECTION.md` 与 frontend README 原以四区 Single-Agent Terminal 为目标；
  Batch 0 负责同步改成两状态 Chat UI。
- **Session catalog contract：** Session sidebar 需要可恢复的 list/load/new contract；不能用 frontend fixture
  冒充生产 Session list。
- **first-send lifecycle：** 已确认 Blank 页第一次 Send 使用 Controller-owned
  `create_session → submit_turn { session_id, text }` transaction；创建与继续发送是两个明确命令。
  失败时不能创建 UI-only loaded Session identity 或丢失 draft。
- **one-shot runtime lifecycle：** 当前 runtime 的首次有效 `create_session` 或 `start_session { session_id }`
  会消费 `AgentConfig`，同一
  runtime 不能创建第二个 Agent。`New Chat` 与 Session switch 必须由 composition root / Tauri bootstrap
  coordinator 显式关闭旧运行环境并创建新的运行环境；创建成功即 Ready，不增加 Handshake。
- **Blank 当前不可构造：** 当前 `App.svelte` mount 后立即调用 `controller.start()`，而 `start()` 默认创建
  Session；当前 snapshot schema 也要求 Session 非空。现有 empty UI 实际是“loaded Session 但没有
  messages”，不是本计划的 `loaded Session = none`。必须先修正 boot/Session contract，不能只加条件渲染。
- **主题当前不可切换：** 当前 `index.html` 固定 `class="dark"`，`styles.css` 的 `:root` 与 `.dark` 都是
  dark token。White theme 需要真实 token 与 preference wiring，不能仅移除 class。
- **dirty frontend batch：** 当前 frontend 正在进行 Svelte/shadcn 迁移且 lockfile 状态未收敛。实现者必须在
  当前 owner 的变更基础上继续，不得 reset、覆盖或重新初始化 frontend。

### 2.3 本计划不决定

- 不新增或猜测 Rust signature、wire DTO、SessionItem variant 或持久化字段；
- 不把首条消息摘要升级为持久化 title；
- 不决定 provider bootstrap 与 credential storage 的新方案；
- 不提交 Git。

## 3. Reference synthesis

### 3.1 采用

| Reference | 采用内容 | MoonTide 调整 |
|---|---|---|
| Unsloth Blank | 大面积留白、居中欢迎语、单一大 Composer、左侧 Recent | 移除 mascot、Model Center、Image、Training 等产品入口 |
| Unsloth Loaded | user compact bubble、assistant plain text、hover action row、Composer 固定在可视底部 | 不复制模型平台操作；只显示 MoonTide 已有 command/tool/approval 能力 |
| DeepSeek Blank | Session list 密度、中央主任务、composer 内次要操作收拢 | 移除品牌模式 chip、搜索产品能力和蓝色品牌表达 |
| DeepSeek Loaded | 稳定阅读宽度、长文本排版、sticky composer、当前 Session selection | 不实现右侧 conversation outline；不把 browser chrome 当 App UI |

### 3.2 拒绝

- 不复制 Unsloth/DeepSeek logo、mascot、品牌色、营销文案或模型市场信息架构；
- 不加入 Activity Rail、第二右栏、Terminal、File tree、tabs、split、dashboard 或 floating status panel；
- 不为视觉丰富度添加 recommendation cards、prompt examples、metrics、avatar 或装饰插画；
- 不显示当前 protocol 不支持的 Fork、Regenerate、Edit history 或 Export action；
- 不把 Tool output 复制成独立执行面。

## 4. Layout contract

### 4.1 Base frame

主验收画布为 `1440 × 900`，桌面窗口允许灵活缩放：

| Surface | Wide default | Constraint |
|---|---:|---|
| Session drawer | 240 px | docked；可在 200–360 px 拉伸；可完全折叠 |
| Main Chat Surface | remaining width | min 560 px |
| Top Bar | 52 px | 当前 Session metadata 与 theme utility |
| Loaded reading column | 720–800 px | 居中；长文本建议不超过约 72 字符/行 |
| Composer | 720–800 px | 与 reading column 同轴 |

Session drawer 在所有验收宽度都占据真实布局空间，不切换为 mobile overlay；Main 随 drawer 宽度重排。
建议 Tauri 主窗口最小宽度为 `720px`；更窄窗口不作为 v0.1 桌面验收目标。

### 4.2 Blank Conversation

```text
┌──────────────────┬────────────────────────────────────────────────────┐
│ MoonTide         │                                            Theme   │
│ + New Chat       │                                                    │
│                  │              How can I help?                       │
│ Recent           │       ┌────────────────────────────────────┐       │
│ Session excerpt  │       │ Ask anything…                      │       │
│ Session excerpt  │       │                               Send │       │
│                  │       └────────────────────────────────────┘       │
│                  │                                                    │
└──────────────────┴────────────────────────────────────────────────────┘
```

- Blank 的定义是 `loaded Session = none`，不是 empty persisted Session；
- Recent rows 可以存在，但没有 row 标记 Loaded；
- 主区域不显示 chat timeline、empty card、feature cards 或 onboarding checklist；
- Composer 在视觉中心略偏下，成为唯一 primary action；
- New Chat 在 Blank 状态只清理 frontend-local draft/selection，不提前持久化空 Session；
- list error 留在 Session drawer；connection/runtime unavailable 在受影响的 Main action 附近内联表达，不创建第三页。

### 4.3 Loaded Conversation

```text
┌──────────────────┬────────────────────────────────────────────────────┐
│ MoonTide         │ Session excerpt                            Theme   │
│ + New Chat       │                                                    │
│                  │       User prompt                                  │
│ Recent           │       ─────────────────────────────────────        │
│ ● Loaded         │       Assistant long-form response                 │
│ Session excerpt  │       thinking / tool / approval inline            │
│ Session excerpt  │                                                    │
│                  │       ┌────────────────────────────────────┐       │
│                  │       │ Ask a follow-up…              Send │       │
└──────────────────┴────────────────────────────────────────────────────┘
```

- Assistant message 使用 plain reading surface，不包裹大 card；
- User message 使用右对齐 compact bubble，但不把长 prompt 压成窄列；
- Copy 等 message actions 只在 hover、focus-within 或键盘聚焦时显示；
- Assistant streaming draft 原位增长；finalized 后保持同一阅读位置；
- thinking、tool、approval、error 与 interrupted response 都是 Conversation 内的 typed block；
- Composer sticky 于 Main Chat Surface 底部，遮挡区域必须通过 scroll padding 预留；
- 用户不在 bottom anchor 附近时，stream update 不强制滚动；显示 `Jump to latest`。

## 5. Theme contract

v0.1 支持两个完整主题：

```text
White theme
Black theme
```

- 第一次启动可读取 `prefers-color-scheme` 选择初始主题；之后只持久化明确的 `white | black`；
- theme preference 是 frontend-local，不进入 RenderState、Session Item Log 或 Desktop protocol；
- 使用 shadcn-svelte neutral tokens；active selection 通过 foreground/background、weight、shape 与
  border 表达，不使用固定品牌蓝/绿；
- approval yellow、success green、danger red 只作为 semantic state token，不能成为常驻 accent；
- `color-scheme` 同步到 native form control；
- normal text contrast >= `4.5:1`，control boundary、focus ring 与 non-text state >= `3:1`；
- 两个主题使用同一 geometry、spacing、font metrics 与 interaction，不维护两套组件 markup。

建议 token ownership：

```text
styles.css
├── :root              # White semantic tokens
├── .dark              # Black semantic tokens
├── @theme inline      # Tailwind/shadcn mapping
└── @layer components  # 少量 MoonTide layout primitives
```

## 6. shadcn-svelte adoption

### 6.1 当前基座

当前 frontend 已配置：

- Svelte 5 + TypeScript + Vite SPA；
- Tailwind CSS v4；
- shadcn-svelte `nova` style、`neutral` base color；
- bits-ui；
- `@lucide/svelte`；
- `Button`、`Textarea`、`ScrollArea`、`Separator`、`Alert`、`Badge`、`Label`、`Card`。

当前 pnpm lock 的关键解析版本为 Svelte `5.57.0`、Vite `8.2.2`、Tailwind `4.3.3`、bits-ui
`2.19.0`、Vitest `4.1.11`。shadcn-svelte 是 source-installed generator，不是 runtime dependency；
当前 generator version 未冻结。新增组件的 review batch 必须记录实际 CLI version，避免用未记录的
`@latest` 产生不可复现 diff。

### 6.2 v0.1 使用范围

| UI need | shadcn-svelte | Rule |
|---|---|---|
| Session navigation | `Sidebar` | 使用 provider/inset/collapse primitives；Session 数据与 selection 由 MoonTide model 提供 |
| Composer | existing `Textarea` + `Button` | textarea behavior 与 submit gate 由 feature 组件拥有 |
| Conversation scrolling | existing `ScrollArea` | 保留 native reading flow 与 bottom-anchor logic |
| Icon help | `Tooltip` | 所有 icon-only control 必须有 accessible name；tooltip 不是唯一 label |
| Row/message menus | `DropdownMenu` | 只注册真实可执行 action |
| Thinking/tool detail | `Collapsible` | closed/open 是 UI-local；tool outcome 仍是 Host fact |
| Listing/loading | `Skeleton` | 只用于 bounded transient loading，不遮盖 recoverable error |
| Notices | existing `Alert` | connection/list/submit failure；不把普通消息做成 Alert |

以下组件本批不引入：

- `Card` 不用于 message、Session row 或 Blank page layout；
- `Tabs`、`Resizable`、`Accordion`、`Command`、`NavigationMenu` 不需要；
- `Dialog`/Settings 不在本批重做；
- 不引入 virtual-chat、chat SDK、Markdown editor 或新的全局 state library。

shadcn CLI 产物属于项目源码，但不要直接把业务语义写进 `components/ui/`。MoonTide feature 组件通过
slot/props 组合原子；token 只在 `styles.css` 维护。CLI update 前必须 review diff，不能覆盖本地 token 或
accessibility fix。

## 7. Frontend ownership 与 data flow

```text
DesktopBridge
    ↓ ordered envelope / snapshot
DesktopController
    ↓ RenderState
chatUiModel(render, sessionCatalog, localUi)
    ↓
Svelte Chat components
    ↓ explicit intents
DesktopController
```

| State | Owner | UI responsibility |
|---|---|---|
| Session catalog、loaded Session identity | Host / Controller projection | list、selection、loading/error projection |
| protocol server generation、runtime readiness | composition root / bootstrap coordinator | 只投影可用性；不决定页面布局 |
| canonical messages、assistant finalized content | Session Item Log / Host | chronological rendering |
| assistant draft、tools、approvals、delivery | Host projection | typed inline block；不从 text 推断 |
| Turn lifecycle、connection、resync | Host / Controller | gate submit/action；显示 notice |
| Composer draft | frontend-local | Blank/Loaded 共用一份 logical draft；rejection 恢复原文 |
| sidebar collapse、theme、message menu、expanded detail | frontend-local | 不写入 Session Item Log |
| auto-scroll anchor | frontend-local | stream update 时保持阅读位置 |

页面模式只能由 loaded Session identity 派生：

```text
loadedSession == none  → Blank Conversation
loadedSession != none  → Loaded Conversation
```

不得用 messages length 判断 Blank；一个刚加载但尚无 message 的 loaded Session 仍属于 Loaded，并显示空的
Conversation timeline 与 loaded identity。

`Blank` 只表示 controller projection 中没有 loaded Session；它不等于某个 runtime lifecycle state。正常可提交时，
composition root 持有一个初始化完成、尚未消费 Session create/load command 的 `Ready` runtime；fresh runtime 创建
失败时，页面仍是带 recoverable notice 的 Blank，但 Composer 禁用。runtime generation、
AgentConfig 消费和重建由 composition root / Tauri bootstrap coordinator 所有；Svelte 只发送 `New Chat`、
`load Session` 和 `submit` intent。

## 8. Session 与 first-send contract

### 8.1 Session list

Sidebar 至少需要：

```text
session_id
first_user_message_excerpt
last_activity_at
loaded
```

`cwd` 只在需要区分同名 workspace 时进入 secondary metadata；不新增 persistent title。Session list failure
与 empty 必须区分。排序由 Host/catalog contract 决定，UI 不以本地时间重新发明顺序。

如果当前 wire 尚无 Session catalog，先完成独立 contract batch。v0.1 pre-release 可以前后端同步升级，
但必须更新 schema、Rust/TypeScript conformance test 与 docs，不能只在 Svelte 中读取 Session 文件。

### 8.2 New Chat 与第一次 Send

从已加载 Session 执行 New Chat 时，controller-owned transaction 固定为：

```text
check close gate while keeping Loaded visible
  → request Shutdown for current generation
  → wait for Stopped and ShutdownCompleted
  → clear loaded Session identity and enter Blank
  → composition root discards old handle
  → create a fresh in-process runtime
  → construction succeeds and becomes Ready
```

- shutdown 确认前保持 Loaded page 与 draft，不提前显示 Blank；
- shutdown 失败时保留最后一个 Loaded projection，并显示明确的 disconnected/retry notice；
- shutdown 已确认成功后必须清除 loaded Session identity；fresh runtime creation 失败时保持 Blank，
  显示 runtime unavailable/retry notice，并且不伪造 Ready 或 loaded Session；
- active Turn、pending approval、stopping 或 unresolved delivery 不满足 close gate 时，New Chat 禁用并说明原因；
- 新 generation 必须获得新的 `connection_epoch`；不得复用已消费或 stopped server；
- transition 不删除旧 Session Item Log，也不后台运行旧 Agent。

Blank 中点击 New Chat 只清理 frontend-local draft/selection，不创建持久化 Session。第一次 Send 使用
Batch 3 的独立命令：

```text
validate draft
  → create_session() exactly once
  → wait for accepted loaded Session identity
  → submit_turn(session_id, text) exactly once
  → on Turn acceptance clear submitted draft
```

- create failure：保持 Blank 与 exact draft；若当前 generation 已被消费并关闭，Retry 必须由
  composition root 创建 fresh runtime 后才重新允许 first Send；
- submit rejection：保持 Loaded identity 与 exact draft；
- Turn 已接受后的模型失败：保留新 Session、用户消息与失败事实，允许后续重试，不删除 Session；
- connection not ready：不开始 sequence；
- double activation：同一个 first-send intent 只执行一次；
- 组件不得自己串接 Tauri invoke 或 wire message。

新 Session 的创建接受点是 `create_session` 返回的 loaded identity；首次 Turn 和继续历史对话都使用
`submit_turn { session_id, text }`。它必须校验 `session_id` 等于当前 loaded Session，身份不匹配时拒绝，
不得隐式加载或切换 Session。Controller 为 first-send transaction 提供 single-flight 与 exact-draft 保护。

如果现有 Host contract 不能安全表达该 sequence，必须先对齐 controller/Host command semantics；不得在 UI
中以 timeout 猜测 Session 已启动。

### 8.3 Load existing Session

- 当前无 loaded Session：在当前 Ready generation 上选择 row 后 request load/start；成功 snapshot 后进入 Loaded；
- 当前已有 loaded Session：先执行与 New Chat 相同的 close/recreate transaction；旧内容保持可见到
  shutdown 确认，随后清除 loaded identity 并进入 Blank，再在 fresh Ready generation 上 request load/start；
- active Turn、pending approval 或未完成 close 会禁用 row switch，并显示明确原因；
- fresh generation 或 load failure 保持 Blank，显示 retry；目标 row 不标记 Loaded，旧 Session 仍保留在 catalog；
- snapshot/resync 最终决定 loaded row 与 Conversation。

## 9. Composer 与 Conversation behavior

### 9.1 Composer

Blank 与 Loaded 复用同一个 `Composer.svelte` 和 draft owner，只改变 placement：

- `Cmd/Ctrl+Enter` Send；普通 Enter 插入换行，保持当前 Desktop contract；
- IME composition 期间任何 Enter chord 都不得 submit；
- empty/whitespace-only 禁 Send；
- Submitting 锁定当前 submission，但不锁定输入下一条 draft；
- active Turn 延续现有单 pending prompt contract；
- attachment、permission control 只有在真实 intent/contract 存在后才显示；
- Stop 与 Send 是不同 action，不能通过切换 send icon 隐藏生命周期含义。

### 9.2 Conversation blocks

最小 block set：

- `UserMessage`；
- `AssistantMessage` / `AssistantDraft`；
- `ThinkingDisclosure`；
- `ToolCallBlock` / terminal outcome；
- `ApprovalBlock`；
- `NoticeBlock` / `InterruptedResponse`。

Tool 仍分别展示 `Succeeded`、`Failed`、`InvalidArguments`、`UnknownTool`、`Denied`、`Cancelled`、
`OutcomeUnknown`。Approval action 只在一个 inline block 中可执行。Snapshot/history/replay 不触发 live sound。

### 9.3 Message actions

第一批只提供有确定 contract 的 action：

- Copy user/assistant text；
- 展开/收起 thinking 或 tool detail；
- approval Allow/Deny；
- Retry connection/list/submit failure。

Edit response、Regenerate、Fork、Export、Read aloud 和 Delete message 全部后置，除非先补业务语义与测试。

## 10. Proposed component map

```text
src/app/
└── App.svelte                         # controller injection + ChatShell mount

src/lib/features/chat/
├── ChatShell.svelte                   # Sidebar + Blank / Loaded branch
├── SessionSidebar.svelte
├── BlankChat.svelte
├── ChatPage.svelte
├── Conversation.svelte
├── Composer.svelte
├── chatUiModel.ts
├── chatUiModel.test.ts
├── ChatShell.test.ts
└── index.ts
```

约束：

- `App.svelte` 只组合 Sidebar 与 ChatSurface，不 fold protocol；
- `chatUiModel.ts` 是 pure derivation，不发送 command；
- feature 组件只接收 view model 与 typed callback，不 import Tauri bridge；
- shadcn 原子继续位于 `components/ui/`；
- `SessionRow`、`MessageBlock`、`ThemeToggle` 等只有在父组件接近 400 行或出现第二个消费者时再拆；
- 自研 production `.svelte` / `.ts` 软性控制在约 400 行以内；
- 不创建 `stores/`、router、page framework 或通用 design-system package。

## 11. Implementation batches

每批独立 review；不把文档、Rust contract 和完整 UI 混成一个大 diff。

### Batch 0 — Contract reset

- 修订 `UI-V0.1-SCOPE.md`、`UI-INTERACTION.md`、`UI-VISUAL-DIRECTION.md`、`UI-STATE.md`；
- 修订 frontend README feature map；
- 明确旧 Single-Agent Terminal 方向为 future/archive，不再作为 v0.1 acceptance；
- 将四张 UI reference 固化到 `crates/moontide-desktop/docs/references/chat-ui/` 并记录 provenance 与状态映射；
- 不改代码。

**Gate：** 文档只描述两种 page state，且 ownership 与 non-goals 无冲突。

### Batch 1 — Frontend baseline

- 确认 pnpm 是唯一 package manager，收敛 canonical lockfile；
- 保留当前 Svelte 5 / Tailwind v4 / shadcn-svelte `nova-neutral` 配置；
- 按需添加 `sidebar tooltip dropdown-menu collapsible skeleton`；
- 建立 White/Black neutral token 与 theme preference helper。

**Gate：** `pnpm test`、`pnpm run check`、`pnpm run build`；无旧 lockfile/依赖漂移。

### Batch 2 — Session catalog contract

- 对齐 Host/protocol session list、new/load/close semantics；
- 由 composition root / Tauri bootstrap coordinator 实现并测试运行环境的
  shutdown → discard → recreate 顺序；创建成功即 Ready；
- Rust/TypeScript schema 与 conformance tests 同步；
- Controller 暴露 catalog projection 与 typed intent；
- 不构建 fake Session sidebar。

**Gate：** ready/empty/error/load failure、唯一 loaded Session identity、resync、`Loaded → Blank → Loaded`、
shutdown failure 与 fresh-generation failure 均可复现；focused Rust protocol/controller tests 通过。

### Batch 3 — Projection 与 UI model

- 扩展或适配 `RenderState` 所需 Session catalog view；
- 实现 `create_session` 与 Controller single-flight create → submit transaction；
- 实现 `chatUiModel` / `sessionListModel` pure derivation；
- 锁定 Blank/Loaded derivation 与 first-send transaction state；
- 先写模型测试，再接 UI。

**Gate：** messages length 不影响 page identity；snapshot 可替换 Host facts且保留 local draft/theme。

### Batch 4 — Shell、Sidebar 与 Blank

**状态：** completed（2026-09-01）。

- 薄化 `App.svelte`；
- 实现 shadcn Sidebar、Session rows、Top Bar 与 Blank Conversation；
- 实现 first-send UI gate，不在组件中直接操作 bridge；
- 完成 White/Black 基础视觉。

**Gate：** `1440×900` 与 `960×720` 无裁切。该批当时采用的 responsive overlay 已由 Batch 5
用户决策替换为 docked、resizable drawer。

### Batch 5 — Loaded Conversation

**状态：** completed（2026-09-01）。

- 实现 reading column、typed message blocks、assistant draft 原位更新；
- inline thinking/tool/approval/notice；
- sticky Composer、bottom anchor 与 Jump to latest；
- 将 Session list 改为 `200–360px` 可拖拽/键盘拉伸的 docked drawer；折叠时 Main 回收宽度，不使用 overlay；
- 不加入未支持 message actions。

**Gate：** 长消息、streaming、tool terminal states、approval、failure/cancel 与 resync 均不改变 page layout；
`960×720` drawer 展开时仍与 Main 并排且没有 modal layer。

### Batch 6 — Interaction、accessibility 与 visual QA

**状态：** in progress（实施拆分见 `UI-V0.1-CHAT-BATCH-6-WORK-PACKET.md`）。

- 完成 keyboard、IME、focus、live region、reduced motion 与 two-theme contrast；
- 使用 `crates/moontide-desktop/docs/references/chat-ui/` 的四张 reference 与 implementation capture 做同状态比较；
- Blank 比较只检查 sidebar density、留白层级、欢迎语/Composer 主次和单一 primary action；Loaded 比较只检查
  reading width、user/assistant 区分、长内容节奏、sticky Composer 与当前 Session selection；不以品牌像素级相似为目标；
- 修复所有 P0/P1/P2；
- 独立 Standards / Spec review；
- 用户 visual review 后才进入 commit gate。

**Gate：** `design-qa.md` final result 为 `passed`；在真实 Tauri 窗口完成 White/Black、keyboard focus、
Session drawer resize/collapse、first-send 与 Session switch smoke；无 WebView console error。

### Batch 7 — Session switching 与 bounded history

**状态：** implemented，独立 Standards / Spec review 无剩余 P0/P1/P2；待用户 diff review。

- 先消除 Loaded Session 切换中的重复 catalog 扫描与重复持久化读取；
- Session catalog 只保留摘要，不把所有完整历史长期放入 frontend 内存；
- initial history 只交付最近 30 个完整 Turn，使用稳定 `before_turn` 游标向上加载更早 Turn；
- prepend older history 时保持阅读位置，失败可重试；
- 先分页并测量，当前不加入 variable-height virtual list。

**Gate：** switch operation sequence、complete-Turn page boundary、stale response、duplicate merge、scroll anchor、
frontend/Rust checks 均有测试；独立 review 与用户 diff review 后才进入 commit gate。

## 12. Validation matrix

| Area | Required evidence |
|---|---|
| Blank | no loaded Session、Recent list、centered Composer、first-send rejection preserves draft |
| Loaded | selected loaded row、chronological messages、stable reading width、sticky Composer |
| Session list | listing、ready、empty、error、load failure；不伪造 title/loaded state |
| Streaming | one draft grows in place；user reading position preserved |
| Tool/approval | seven tool outcomes；one actionable approval owner；stale resolves by snapshot |
| Composer | keyboard + IME、double-submit guard、pending/held、Stop independent |
| Connection | resync/disconnect preserve draft and history projection；Host facts come from snapshot |
| Theme | White/Black geometry identical；AA contrast；semantic colors only when needed |
| Responsive | 标准缩放检查 `1440×900`、`1280×800`、`960×720`；`1440×900` 单独检查 200% zoom，等效 CSS 宽度不低于 720 px；无隐藏 critical action |
| Accessibility | logical focus order、visible focus、drawer keyboard resize、live announcements |
| Frontend | `pnpm test`、`pnpm run check`、`pnpm run build` |
| Rust/protocol | affected crates 的 focused tests、schema/conformance fixtures、最终 `just check` |
| Desktop smoke | 真实 Tauri window；Blank/Loaded、White/Black、focus/drawer、first-send/switch、WebView console |

## 13. Acceptance criteria

- 产品主界面只能被识别为 Blank 或 Loaded Conversation；
- 用户无需理解 Workbench、Terminal、Agent Dock 或 split 即可开始/恢复对话；
- Sidebar 清楚区分 loaded Session 与 navigation candidate；同时最多一个 loaded Session；
- Blank 页只有一个 primary action；Loaded 页 Conversation 是唯一内容主面；
- Composer 在两种状态中保持同一 draft、shortcut、submit gate 与 accessibility semantics；
- Assistant、Tool、Approval 和 failure 都在 Conversation chronology 中表达，不产生第二内容面；
- White 与 Black 为同等完成度，不使用常驻品牌 accent；
- shadcn-svelte 只提供 interaction/accessibility primitives，不拥有 MoonTide business facts；
- current protocol 不支持的参考产品功能不会以假按钮出现；
- production code、docs、tests 与 QA evidence 通过独立 Standards / Spec review；
- 未经用户 diff review 不 commit。

## 14. Non-goals

v0.1 本计划明确不做：

- Agent Terminal、PTY、Shell/Agent mode、Terminal Focus；
- File tree、File preview/edit、Diff review；
- Content tabs、split panes、Activity Rail、Agent Dock、Context panel；
- Floating Island / Companion；
- Plan、Pins、Task、multi-agent、多 Session 并发；
- model hub、training、image workflow、web search 产品入口；
- conversation outline、fork、regenerate、edit history、export、read aloud；
- SvelteKit、router、SSR、全局 state library、通用 design system；
- 在本计划批修改生产代码或提交 Git。

## 15. Confirmed decisions

用户于 2026-09-01 确认进入实现：

1. v0.1 正式从 Single-Agent Terminal 改为两状态 Session Chat client；
2. Blank Conversation 的第一次 Send 才创建 Session；
3. White/Black 为等价主题，且无常驻品牌 accent；
4. Loaded Conversation 保留 inline Tool 与 Approval，不再提供独立执行面；
5. 实现从 Batch 0 Contract reset 开始，每批独立 review，未经用户授权不 commit。
