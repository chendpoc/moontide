# MoonTide Desktop v0.2 Hybrid Shell

> **性质：** candidate Feature Task 与架构对齐文档
> **状态：** 用户已确认版本方向；native carrier 与应用退出语义仍待验证；未实现
> **版本目标：** v0.2 Hybrid Shell foundation
> **当前产品基线：** [`../UI-V0.1-SCOPE.md`](../UI-V0.1-SCOPE.md)
> **首批 Work Packet：** [`../tasks/HYBRID-SHELL-V0.2-BATCH-1-WORK-PACKET.md`](../tasks/HYBRID-SHELL-V0.2-BATCH-1-WORK-PACKET.md)

## 1. 结论

MoonTide Desktop v0.2 的第一条 Hybrid 路径是：

> **Tauri/Svelte 负责产品内容，Rust/macOS AppKit 负责原生窗口语义。**

本 Feature 不把 Swift UI 与 Svelte UI 各做一半，也不改变 Agent、Session Item Log、Turn 或
Approval 的事实所有权。现有 Session Chat 继续由普通 Workspace window 承载；新增的
Control Center 是同一 Runtime 事实的轻量投影和窗口级控制面。

v0.2 第一阶段仍只有一个 loaded/running Session、一个 Agent 和一个 active Turn。
Control Center 不伪造多个后台 Task，也不提前实现完整 Activity Center。

## 2. 用户问题

现有 v0.1 Session Chat 可以承载 Workspace 内容，但无法验证以下 macOS-first 体验：

- 低打扰、常驻的 compact surface；
- compact 与 expanded 之间连续改变原生窗口 frame；
- always-on-top、focus、Spaces 和多显示器定位；
- 从轻量状态入口回到 Workspace；
- Svelte 内容动画与原生窗口动画之间的明确边界。

本 Feature 要回答的不是“能否画出灵动岛外形”，而是：

> 在不复制业务事实、不破坏现有 Runtime 生命周期的前提下，Tauri + AppKit 是否能提供足够可靠的
> macOS Control Center window semantics？

## 3. 当前状态与目标状态

### 3.1 当前状态：v0.1

```text
Tauri app
└── main WebviewWindow · 960 × 720
    └── Svelte Session Chat
        └── one DesktopRuntimeCoordinator
```

- `main` 是唯一 window label。
- 任意 window 的 `CloseRequested` 当前都会进入 Runtime shutdown。
- `default` capability 只匹配 `main`，并允许完整 Session/Turn command 集合。
- `desktop-envelope` 与 `desktop-connection` 由 AppHandle 广播。
- v0.1 明确排除 Floating Island、multi-window 和后台 Session。

### 3.2 目标状态：v0.2 foundation

```text
MoonTide.app
├── WorkspaceWindow · normal NSWindow
│   └── Svelte Session Chat
│
├── ControlCenterWindow · macOS-native window semantics
│   └── Svelte Control Center surface
│       ├── compact
│       └── expanded
│
└── one DesktopRuntimeCoordinator
    └── one loaded/running Session
```

`ControlCenterWindow` 是产品角色名，不预先承诺其 Objective-C 实例一定是 `NSPanel`。
Batch 1 先验证 Tauri 创建的 `NSWindow` 经 AppKit 定制后是否满足体验；只有证据证明不足时，才选择
真实 `NSPanel` 的承载方案。

## 4. 产品范围

### 4.1 WorkspaceWindow

- 保留现有 v0.1 Session Chat 信息架构和 Svelte 组件。
- 保持普通、可调整尺寸的 macOS window 行为。
- 继续是完整 Conversation、Composer、Tool、Approval 和 history 的主工作面。
- 本 Feature 不把 Workspace 改成 `NSPanel`。

### 4.2 ControlCenterWindow

最终 feature slice 有两个 UI mode：

| Mode | 目的 | 内容边界 |
|---|---|---|
| `compact` | 低打扰显示当前 Session 是否工作或需要注意 | 当前 Session identity、run/attention state；无历史、无完整 Chat |
| `expanded` | 查看当前 Session 摘要并进入 Workspace | 同一 Session 的更完整状态、明确的 `Open Workspace`；首阶段不执行 Approval/Cancel |

初始 geometry 是待真实窗口 review 的基线，不是品牌视觉冻结值：

- compact：`280 × 52` logical points；
- expanded：`380 × 360` logical points；
- 首次使用 `main` 所在 screen，无法解析时回退 primary screen；后续使用 Control Center 当前 screen；
- 右上角锚定所选 screen 的 `visibleFrame`，默认 margin `16pt`；
- frame 变化保持右上角 anchor 稳定。

expanded 不使用 `640pt` 高度，因为当前只有一个 active Session；在完整 Activity Center 有真实消费者前，
不能用空白或 fixture 模拟多任务列表。

## 5. 所有权

| State / behavior | Owner | 约束 |
|---|---|---|
| Session、Turn、Tool、Approval、delivery facts | Desktop Host / Runtime | Control Center 只投影，不复制或修改事实 |
| runtime generation 与 shutdown | DesktopRuntimeCoordinator / composition root | 不由任一 Svelte component 推断 |
| native window identity、frame、level、focus、Spaces、visibility | Tauri Rust shell | 不进入 Session Item Log 或 Desktop protocol |
| `compact \| expanded` mode | Tauri Rust shell 的 ephemeral window state | Svelte 发 intent，Rust 接受后发布已应用 mode |
| Control Center RenderState | Control Center frontend projection | 可丢弃、可从 snapshot/resync 重建 |
| disclosure、hover、内部 transition | Svelte local UI | 不改变 native frame authority |

不允许以下所有权路径：

```text
Control Center component → Session JSONL
Control Center component → Agent::turn
Workspace WebView → authoritative state relay → Control Center
Control Center local store → canonical Approval / Turn state
```

## 6. Window identity 与生命周期

固定 window labels：

```text
main
control-center
```

规则：

1. `main` 与 `control-center` 是两个 view，不是两个 Runtime。
2. Control Center 在 app lifetime 内隐藏/显示或 compact/expand；不得因为自身 close 请求关闭 Runtime。
3. Batch 1 保留 `main` close → graceful Runtime shutdown 的现有语义，避免 spike 静默改变应用退出模型。
4. 产品化前必须单独决定：Workspace close 是退出应用还是只隐藏 Workspace。该决定会影响 Dock、Quit、
   Control Center 常驻和 Runtime 生命周期，属于 L3 gate。
5. app quit 必须最多触发一次 graceful shutdown；第二 window 的 close event 不得形成第二次 shutdown。

## 7. Native window contract

### 7.1 Rust/AppKit 负责

- 创建和识别 `control-center` window；
- AppKit 主线程上的 frame 计算与动画；
- always-on-top、collection behavior、focusability 和 shadow；
- `NSScreen.visibleFrame` 内的定位与屏幕切换；
- close/hide、expand/collapse 与 Workspace activation；
- 将 native failure 作为 typed command error 返回。

### 7.2 Svelte 负责

- compact/expanded 内部内容和布局；
- 状态文本、icon、局部 opacity/height transition；
- `Expand`、`Collapse`、`Open Workspace` intent；
- `prefers-reduced-motion` 下取消非必要内部动画；
- 不循环调用 `setSize` / `setPosition` 驱动原生 frame。

### 7.3 线程和安全

- 所有 AppKit object 访问必须发生在 main thread。
- `ns_window()` 返回值只能按对象真实 class 使用；禁止把普通 `NSWindow` 指针直接 cast 成 `NSPanel`
  后调用 `NSPanel`-only API。
- Batch 1 禁止自行使用 `object_setClass`、method swizzling 或复制第三方 panel macro。
- unsafe block 必须被封装在 macOS-only shell module，并逐处写清真实对象类型、线程和生命周期不变量。

## 8. Projection 与事件顺序

完整 feature 的推荐路径：

```text
Desktop Host facts
  → ordered desktop-envelope
  → each WebView installs its own snapshot baseline
  → Workspace RenderState / Control Center RenderState
```

- 两个 WebView 可以拥有独立、可丢弃的 RenderState，但不能拥有独立业务事实。
- Control Center 必须 listener-first，再请求 snapshot；晚创建或重建时不得从遗漏的 live event 推断状态。
- 每个 WebView 独立验证 `connection_epoch` 与 `seq`，gap 时请求 snapshot/resync。
- Control Center 的 projection 只选择现有 snapshot 中当前 Session 的 identity、run 和 attention state；
  不新增 Session Item，也不把 UI mode 写入 protocol。
- Batch 1 不接 Runtime event，只使用明确标记的 diagnostic surface 验证 native carrier；该 surface 不得作为
  product completion evidence，并在后续批次替换。

## 9. Capability boundary

最终状态需要两个 capability：

| Capability | Window | Authority |
|---|---|---|
| `default` | `main` | 现有 Session、Turn、Approval command 集合 |
| `control-center` | `control-center` | event listen/unlisten、read-only snapshot，以及 scoped native window intents |

首阶段 Control Center 不获得：

- `submit_turn`、`cancel_turn`、`approve`、`deny`；
- filesystem、shell、process 或 global Tauri authority；
- 任意 window label、position 或 size 参数。

Native command 使用封闭 enum / 固定目标：

```text
set_control_center_mode { mode: compact | expanded, reduce_motion: bool }
open_workspace
```

前端不能提交 raw frame、screen ID、window label、level 或 AppKit flag。

## 10. Native carrier 方案

### Option A — Tauri WebviewWindow + NSWindow customization

**Batch 1 采用。**

- 使用当前 Tauri/Wry 创建的真实 `NSWindow`。
- 只调用对象真实支持的 `NSWindow`、frame、level、focus 和 collection behavior API。
- 优点：依赖最少，沿用 Tauri window ownership 和 WebView lifecycle。
- 风险：non-activating/floating focus semantics 可能无法达到 Control Center 验收。

### Option B — `tauri-nspanel`

**只作为失败后的候选，不在 Batch 1 引入。**

- 第三方库通过自定义 `NSPanel` subclass 和 Objective-C runtime class replacement 将 Tauri window 转成 panel。
- 优点：已有 Tauri/WebView integration 和 panel-specific behavior。
- 风险：Git dependency、class replacement、Tauri/TAO 内部兼容性和长期维护成本。

### Option C — 自有 AppKit NSPanel host

**Deferred。**

- 直接创建 `NSPanel` 并自行解决 Tauri/Wry WebView 的 attach、delegate 和 lifecycle integration。
- 控制力最高，但会复制 window/WebView ownership，首阶段没有证据支持该复杂度。

Decision rule：Option A 只有在真实窗口验收通过时才能进入产品实现；若 focus、Spaces 或 activation 任一核心
行为失败，停止 Batch 1，回到 Architecture Alignment，在 Option B / C 中做显式选择。

## 11. 实现顺序

| Batch | Deliverable | Gate |
|---|---|---|
| **1 Native carrier spike** | macOS-only secondary NSWindow，compact/expanded frame、focus、Spaces、screen anchor、Workspace activation | 真实 Tauri window QA；不接 Runtime facts |
| **2 Read-only projection** | dedicated capability、listener-first snapshot、当前 single Session 状态投影 | ordering/resync tests；Control Center 不拥有业务事实 |
| **3 Product surface** | Vibe Island attention model + 局部 pixel accent；替换 diagnostic surface | visual、keyboard、reduced-motion、accessibility review |
| **4 Scoped actions** | 是否加入 Approval/Cancel 的独立决策与 Work Packet | 需要明确权限、stale action 和 failure semantics；默认 deferred |

每批完成后停止写代码，执行独立 Standards / Spec review 和用户 diff review。未经明确授权不 commit。

## 12. Feature acceptance

完成 v0.2 foundation 必须同时证明：

1. Workspace 继续使用现有 Session Chat，Host/Runtime 行为没有被第二 window 复制。
2. Control Center compact 默认不抢走其他 app 的 keyboard focus。
3. compact → expanded → compact 的 native frame 连续变化，右上角 anchor 稳定且无明显 WebView flash。
4. expanded 中 `Open Workspace` 激活正确的 `main` window；不存在第二 Runtime。
5. primary/secondary display、不同 scale factor 和可见屏幕边界下不越界。
6. Spaces/full-screen 组合的实际行为有记录；不能仅靠 unit test 宣称通过。
7. Control Center 晚创建、隐藏后恢复或重建时通过 snapshot 建立事实基线。
8. event gap、snapshot failure、native window command failure 都有明确恢复路径。
9. `control-center` capability 不能调用 Turn/Approval/filesystem/shell/process command。
10. main window 的 close/shutdown 不回归，Control Center close 不重复 shutdown。
11. White/Black、keyboard、VoiceOver label、200% zoom 和 reduced motion 有真实窗口证据。
12. `just check`、frontend tests/check/build 与 real Tauri smoke 均通过。

## 13. Non-goals

- 多 active Session、后台 Runtime、完整 Activity Center 或 scheduler。
- Chat → Task promotion、Workstream、Semantic Reducer、tagging 或 local model。
- Swift/SwiftUI UI。
- menu bar、notch positioning、global shortcut、mouse pass-through。
- Control Center 内直接提交 prompt、处理 Approval 或取消 Turn。
- 自有 `macos-window` crate；先在 Desktop shell 内证明第二个消费者。
- Windows/Linux 的 floating surface parity；非 macOS build 必须继续可编译且不出现假入口。
- 改变 Session Item Log、Desktop wire DTO 或持久化格式。

## 14. 主要风险与停止条件

### Hard Blockers

- 需要通过错误的 `NSWindow → NSPanel` cast 才能满足行为。
- 需要自行 class-swizzle 才能继续 Batch 1。
- 第二 WebView 要求 Runtime、SessionStore 或 ApprovalBroker 产生第二 owner。
- Control Center 只能靠 fixture 冒充真实 active Task 才能通过 product acceptance。
- 关闭任一 window 会重复 shutdown、丢失 active Turn 或留下无法退出的 Runtime。

### Replan conditions

- native carrier 变化为真实 `NSPanel`、Swift bridge 或第三方 plugin：L2 dependency/ownership decision。
- Workspace close 从 quit 改为 hide、应用变为后台常驻：L3 product lifecycle decision。
- 第一阶段增加 Approval/Cancel：L2 permission/failure decision。
- 扩展成多 Session Activity Center：新 Feature，不扩大本任务。

## 15. Evidence

Live checkout（2026-09-03）：

- `tauri` 当前解析为 `2.11.5`，`tao` 为 `0.35.3`，`wry` 为 `0.55.1`，
  `objc2-app-kit` 为 `0.3.2`。
- TAO 的 macOS window holder 长期持有 `Retained<NSWindow>`；Tauri `ns_window()` 返回该 native handle。
- `objc2-app-kit` 暴露 `NSWindow::setFrame_display_animate`，也暴露真实 `NSPanel` constructor 与
  `isFloatingPanel` / `becomesKeyOnlyIfNeeded`。

External references：

- [Tauri WebviewWindow API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html)
- [Tauri window customization](https://v2.tauri.app/learn/window-customization/)
- [Apple NSPanel](https://developer.apple.com/documentation/appkit/nspanel)
- [`tauri-nspanel` source](https://github.com/ahkohd/tauri-nspanel) — implementation evidence only，未采用

## 16. Open decisions

按依赖顺序逐个决定：

1. Batch 1 的 customized `NSWindow` 是否通过真实 focus/Spaces/activation 验收？
2. 如果不通过，采用第三方 `NSPanel` integration 还是自有 native host？
3. Workspace close 在 v0.2 是 quit 还是 hide？
4. Control Center 被隐藏后由 Dock reopen、menu bar 还是 global shortcut 恢复？
5. 何时出现第二个真实 active Session consumer，从而启动完整 Activity Center Feature？
