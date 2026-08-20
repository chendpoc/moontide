# Desktop UI 技术决策

> **状态：** 已确认
> **决策：** MoonTide Desktop v0.1 使用 Iced
> **目标平台：** macOS / Windows / Linux

## 1. 决策

Iced 是 Desktop 的唯一 UI framework。选择依据：

- Rust-native，不携带 bundled Chromium；
- message/update/view 模型与 `RenderState` 天然匹配；
- Desktop Host、Agent 和 UI 的 ownership 可以保持显式；
- 不需要 WebView、JavaScript 或 frontend/backend invoke；
- 适合后续系统窗口组件、小组件和键盘交互方向。

Iced 只属于 Desktop UI 层。`agent-core`、`agent` 和 Host actor 不依赖 Iced。

## 2. 运行时边界

```text
Iced application
  ├── Message → update → view
  ├── Subscription → DesktopEventStream::recv
  └── Task → DesktopHostHandle command
             │
             ▼
Desktop Host Actor
  └── Tokio runtime + agent::Agent
```

UI thread 不执行 provider、tool 或 Session IO。UI 只消费 `DesktopEventEnvelope`，将其
fold 成自己的 `RenderState`；Host 不知道 Iced widget、theme 或 layout。

## 3. 被排除的方案

### Electron

排除 bundled Chromium、Node runtime、体积和空载资源开销，不进入产品架构。

### Tauri

不是当前默认方案。它依赖 system WebView，仍会引入 HTML/CSS/JavaScript、WebView 和
frontend/backend invoke。只有出现真实 Web frontend 或 Web/Desktop 共用需求时重新评估。

### Slint

保留为历史调研候选，但不是实现目标。`.slint`、`ModelRc`、
`invoke_from_event_loop` 和 Slint license/attribution 不进入 MoonTide Desktop 合约。

### egui / eframe

保留为快速原型或内部诊断工具候选，不作为正式 Desktop UI。

## 4. Iced D3 验收边界

D3 需要验证：

- 单窗口启动和关闭；
- `DesktopEventStream` 到 `RenderState` 的 Subscription 接缝；
- Conversation 长文本、流式 assistant draft 和 Tool card；
- Composer 输入、Send、Stop、Approval decision；
- light/dark theme、键盘操作和三平台构建；
- 不把 UI state 或 Iced 类型泄漏到 `agent` / `agent-core`。

固定内存、磁盘和启动数字必须通过 Iced-only 实测，不把其他框架的数字当作工程事实。
