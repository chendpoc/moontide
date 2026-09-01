# MoonTide Desktop v0.1 Chat Visual Direction

> **名称：** Session Chat
> **性质：** v0.1 visual direction 与 layout specification
> **状态：** Product direction confirmed；production visual review pending
> **范围：** [`UI-V0.1-SCOPE.md`](UI-V0.1-SCOPE.md)
> **交互：** [`UI-INTERACTION.md`](UI-INTERACTION.md)
> **实施：** [`UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`](UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md)

## 1. Visual thesis

MoonTide v0.1 是安静、专注的 Session Chat client。用户应立即看懂：

1. 左侧用于 New Chat 与恢复 Recent Session。
2. 主区域只有当前 Conversation。
3. Blank 时 Composer 是唯一 primary action。
4. Loaded 时 Conversation 是唯一内容主面。
5. Tool、Approval 与 failure 属于 chronology，而不是第二执行面。

```text
Navigation      Session Sidebar
Identity        Top Bar
Content         Blank hero or Conversation
Primary input   Shared Composer
```

旧 Single-Agent Terminal、Tideglass Workbench、Moonwake concept 与四区布局仅为历史探索，不具有 v0.1 layout、copy、state 或 interaction 权威性。

## 2. Reference synthesis

四张内部设计参考应存放于 `references/chat-ui/`：

- `unsloth-blank.png`
- `unsloth-loaded.png`
- `deepseek-blank.png`
- `deepseek-loaded.png`

采用：

- Unsloth Blank 的大面积留白、居中任务、单一大 Composer 与 Recent navigation。
- Unsloth Loaded 的 compact user bubble、assistant plain text、hover actions 与底部 Composer。
- DeepSeek Blank 的 Session list 密度与 composer 内次要操作层级。
- DeepSeek Loaded 的稳定 reading width、长文本节奏与 selected Session。

调整：

- 移除 mascot、品牌 logo、模式 chip、模型市场、training、image 和 web search 入口。
- 只展示 MoonTide 已有 command、tool、approval 与 connection 能力。
- reference 只决定空间、密度和交互表达，不改变 Host/Session/protocol 语义。

拒绝：

- 品牌色、营销文案、推荐卡、prompt example、metric、avatar 与装饰插画。
- Activity Rail、右侧 outline、Terminal、File tree、tabs、split、dashboard 或 floating panel。
- Fork、Regenerate、Edit history、Export 等无 contract action。
- 把 tool output 复制为独立执行 surface。

## 3. Material and hierarchy

使用 shadcn-svelte neutral semantic tokens：

- White：接近纸面的 neutral background、低对比 panel、清晰前景。
- Black：接近墨面的 neutral background、微小层级差、清晰前景。
- active selection 依靠 foreground/background、weight、shape 与 border。
- approval yellow、success green、danger red 只用于相应状态。
- 不使用常驻品牌蓝/绿、gradient、glow、blur、transparent shell 或 grain。
- 分隔主要依赖 1px border 与 whitespace，不堆叠 Card。

White 与 Black 使用同一 geometry、spacing、font metrics、component markup 和 interaction。

## 4. Typography

- UI 与 conversation 使用系统 sans stack。
- tool input/output 与 code 使用系统 mono stack。
- Assistant 正文目标每行不超过约 72 个拉丁字符；中文按同一视觉宽度约束。
- 正文 line-height 约 `1.65`；metadata 与 Sidebar rows 更紧凑。
- welcome heading 只承担页面定位，不使用营销级超大字号。
- Session excerpt 单行截断；完整 identity 通过 tooltip或可访问 label 提供。

## 5. Shared frame

### 5.1 Authoritative canvas

主画布 `1440 × 900`：

```text
0–239       Session drawer · default 240px
240–1439    Main Chat Surface · remaining width
top         Top Bar · 52px
center      Reading/Composer column · 720–800px
```

规则：

- Session drawer 默认 `240px`，允许在 `200–360px` 内显式拉伸；内容本身不改变宽度。
- Main 最小宽度 `560px`。
- reading column 与 Composer 同轴。
- Main 横向 padding 随 viewport 缩小，不压窄正文到不可读。
- Loaded Composer sticky 于底部；Blank Composer 位于视觉中心略偏下。

### 5.2 Session Sidebar

从上到下：

1. MoonTide wordmark。
2. `New Chat` primary navigation action。
3. `Recent` label 与 listing state。
4. Session rows。
5. 不放常驻 connection status；异常在受影响的 Main action 附近内联说明。

Session row 显示 excerpt 与 last activity。Loaded row 使用可见 selection shape、weight 和 `Loaded` 文本或 accessible state；不只靠一个彩色圆点。

list loading 使用 bounded Skeleton。empty 提供安静说明，不新增 CTA，因为 New Chat 已存在。list failure 提供 Retry。

### 5.3 Top Bar

- Blank：保留低密度空间，右侧仅 theme utility。
- Loaded：显示当前 Session excerpt，右侧仅 theme utility；不放 connection badge。
- 不加入 model picker、Share、Export、tabs 或第二 navigation。
- icon-only control 至少 `32×32` 且有 accessible name。
- v0.1 不为单独的 connection state 增加底部 Status Bar；多个 workspace 级状态/操作形成真实消费者后再设计。

## 6. Blank Conversation frame

### 6.1 Purpose

没有 loaded Session 时，主任务是输入第一条 prompt；Recent navigation 保持可达，但不与 Composer 争夺层级。

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

Required copy：

- `New Chat`
- `Recent`
- `How can I help?`
- `Ask anything…`
- `Send`

视觉规则：

- welcome + Composer 作为一个居中组，整体略低于垂直中心。
- Composer 是页面唯一 elevated surface，但不使用大 Card 阴影。
- 不显示 empty conversation card、feature grid 或 prompt examples。
- runtime unavailable notice 靠近 Composer，但 secondary 于 draft。

## 7. Loaded Conversation frame

### 7.1 Purpose

加载 Session 后，reading column 是唯一内容主面；Composer 稳定贴底，Sidebar 清楚标记当前 Session。

```text
┌──────────────────┬────────────────────────────────────────────────────┐
│ MoonTide         │ Session excerpt                            Theme   │
│ + New Chat       │                                                    │
│                  │                         compact user prompt bubble  │
│ Recent           │       assistant plain long-form response           │
│ ● Loaded         │       thinking / tool / approval inline            │
│ Session excerpt  │                                                    │
│ Session excerpt  │       ┌────────────────────────────────────┐       │
│                  │       │ Ask a follow-up…              Send │       │
└──────────────────┴────────────────────────────────────────────────────┘
```

视觉规则：

- user bubble 右对齐，宽度由内容决定但设合理 max-width。
- assistant 不包大 Card；正文与 typed blocks共享 reading rhythm。
- message group 之间使用 whitespace；同一 assistant 内 block 更紧密。
- action row 仅在 hover、focus-within 或键盘聚焦时出现。
- assistant draft 与 finalized 使用相同 geometry。
- sticky Composer 背后使用 solid background与轻边界，不使用 glass blur。
- `Jump to latest` 位于 Composer 上方中央，不遮挡 message action。

## 8. Composer

Blank 与 Loaded 使用同一 geometry：

- rounded rectangle 与清晰 1px boundary。
- textarea auto-grow 有上限；超过后内部滚动。
- primary Send 位于右下或右侧稳定位置。
- keyboard hint、pending 或 failure 文案位于 secondary row。
- Stop 是独立、带文字或明确 label 的 control，不把 Send icon变形为含糊状态。
- disabled 仍保持可读 boundary，且有原因文本。
- focus ring 在 White/Black 均至少 `3:1`。

不显示 attachment、search、permission、model 或 voice 按钮，除非对应 contract 已实现。

## 9. Conversation blocks

### 9.1 User and assistant

- User：compact neutral fill，右对齐，无 avatar。
- Assistant：plain surface，左对齐，无 avatar/name repetition。
- Copy action使用 icon + accessible label；成功反馈不移动布局。

### 9.2 Thinking

- closed state 显示 `Thinking`/`Thought process` 与 disclosure indicator。
- open state使用低对比 inset，不与 assistant final answer 等权。
- streaming thinking 不使用连续 pulse。

### 9.3 Tool

- compact header 显示 tool name 与 text outcome。
- detail 展开后使用 mono 区域显示安全内容。
- 七种 terminal outcome 使用文字 + icon/shape + semantic color。
- `OutcomeUnknown` 使用明确 warning 边界和“执行结果未知”。

### 9.4 Approval

- inline block 与 chronology 同轴，不弹出独立工作台。
- Pending 显示 operation、target、Allow、Deny。
- action resolving 时按钮锁定并保留状态文本。
- stale/failed 显示 recovery notice，不保留可点击旧按钮。

### 9.5 Notice and interrupted response

- connection/list/submit notice 使用 compact Alert geometry。
- Interrupted response保留已有 partial text并清楚标注未提交。
- notice 不使用全宽高饱和背景，不抢过 Conversation 主内容。

## 10. Theme tokens

Token ownership固定在 `styles.css`：

```text
:root              White semantic tokens
.dark              Black semantic tokens
@theme inline      Tailwind/shadcn mapping
@layer components  少量 MoonTide layout primitives
```

- `index.html` 不固定 dark class。
- `color-scheme` 与当前 preference 同步。
- semantic foreground/background/border/ring 在两主题逐一验证。
- 不维护 theme-specific component markup。

## 11. Responsive modes

### Docked: all validated viewports

- Session drawer 默认 `240px`，可拉伸至 `200–360px` 或完全折叠。
- Main 保持 `720–800px` reading column。
- 额外宽度只增加外侧留白，不无限加宽文字。
- drawer 展开时占据真实布局宽度并使 Main 重排，不覆盖 Conversation。
- drawer 不创建遮罩、focus trap 或 modal semantics。

### Acceptance specimens

- `1440×900`：默认构图。
- `1280×800`：保持 Sidebar 与 reading width。
- `960×720`：Session drawer 与 Main 并排；Composer 与 Top Bar 不裁切。
- `1440×900 @ 200%`：等效 CSS 宽度 `720px`，关键操作仍可达。

更窄窗口不是 v0.1 主验收目标；允许垂直滚动，不允许关键操作水平裁切。

## 12. Motion

- 默认只允许短 opacity/color/height transition。
- streaming 依靠内容增长，不使用打字光标之外的持续动画。
- Session drawer hover/focus affordance 可以使用短 color transition；拖拽宽度不做滞后动画。
- `prefers-reduced-motion` 下移除 smooth scroll、translation、scale 与 pulse。
- 状态变化始终可由即时 text/shape/border 理解。

## 13. Accessibility visual gate

- normal text contrast ≥ `4.5:1`。
- large text、boundary、focus indicator 与 non-text state ≥ `3:1`。
- Loaded、tool outcome、approval 与 connection 不只用 color。
- focus ring 不被 sticky Composer、drawer boundary 或 overflow 裁切。
- icon-only target 至少 `32×32`；primary target 目标 `40×40`。
- `200%` zoom 保留 New Chat、Send、Stop、Approval、Retry、Jump to latest 与 theme。
- Skeleton、streaming 与 live status 不制造不可关闭的视觉噪音。

## 14. Production QA

实现 capture 必须与同状态 reference 比较：

- Blank：Sidebar density、留白层级、welcome/Composer 主次、唯一 primary action。
- Loaded：reading width、user/assistant 区分、长内容节奏、sticky Composer、Loaded selection。
- 不做品牌像素级复刻。

最终 `design-qa.md` 必须记录：

- White/Black 的四个 viewport/zoom specimen。
- keyboard focus 与 Session drawer 拉伸/折叠。
- first-send、Session switch、streaming、tool、approval 和 failure state。
- contrast 与 reduced-motion 结果。
- WebView console error 与真实 Tauri smoke。

## 15. Non-goals

- landing-page visual language。
- production branding exploration、mascot、illustration。
- Terminal、File、Plan、Pins、Activity Rail、Agent Dock、Floating Island。
- tabs、split、dashboard、outline 或第二内容 pane。
- transparent/notched window、blur、gradient、glow。
- unsupported action 或 fake control。
- 删除旧历史 concept asset；它们保留但不再作为权威 reference。
