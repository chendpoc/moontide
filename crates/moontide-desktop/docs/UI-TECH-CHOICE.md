# Desktop UI 技术决策

> **状态：** D3-PF 已落地；Tauri 2 + Svelte + TypeScript 版本由 frontend lockfile 冻结
> **决策：** MoonTide Desktop v0.1 放弃 Iced，采用 Tauri 2 + 轻量 Web 前端
> **目标平台：** macOS / Windows / Linux

## 1. 决策

Desktop UI 采用 Tauri shell 承载轻量 Web 前端。推荐前端组合是 Svelte + TypeScript：
组件和状态边界足够直接，适合当前单窗口、单活跃 Session、单活跃 Turn 的 Workbench，
同时保留未来 Web frontend 共用 UI projection 的可能性。当前不引入大型状态管理框架；
`RenderState` 和 protocol client 由前端自己的小型模块拥有。

Tauri 只属于 Desktop shell 层。`agent-core`、`agent`、Agent Host 和
`desktop::protocol` 不依赖 Tauri、Svelte、TypeScript 或 WebView。

选择依据：

- Tauri 使用系统 WebView，不打包 bundled Chromium；
- Web 前端适合对话流式展示、Tool card、Inspector、主题和文本交互；
- Tauri Rust bridge 可以把窗口生命周期、权限能力和 protocol client 留在 Rust 边界；
- 前端可以作为独立 Web consumer 验证，迫使 `desktop::protocol` 真正成为跨语言 contract；
- `agent-core` 与 Agent Host 的 ownership、Session Item Log 和错误语义不随 UI 技术变化。

这不是把业务事实搬到 JavaScript。前端只拥有 view projection、用户输入 draft、窗口偏好
和连接状态；Rust Host 仍拥有 Agent、SessionStore、ApprovalBroker、取消和关闭清理。

## 2. 运行时边界

```text
Svelte + TypeScript WebView
  ├── RenderState / view projection
  ├── protocol client
  └── Tauri invoke / event adapter
             │
             ▼
Tauri Rust desktop shell
  ├── window lifecycle
  ├── typed command bridge
  ├── protocol client / reconnect
  └── no SessionStore ownership
             │ versioned desktop::protocol
             ▼
moontide-agent-host
  └── Agent + SessionStore + ApprovalBroker + lifecycle
```

Tauri command 只负责前端 intent 到 `DesktopCommand` 的边界转换；它不能直接调用
`Agent::turn`、绕过 Host，或把 `SessionItem` 暴露给 WebView。Host 推送的事件必须是
`DesktopProtocolEvent`，而不是 `TurnEvent`、`ProgressEvent` 或 runtime ownership type。

Tauri event 只承载已经合并、可丢失且可 resync 的 Desktop protocol message。它不是
Session Item Log，也不是 Agent Event Log。高频 assistant snapshot 的合并、seq、epoch、
resync 和 cleanup 继续由 Host/EventBuffer/协议层决定。

## 3. 前端框架边界

已采用：Svelte + TypeScript + **shadcn-svelte**（Tailwind CSS v4 + bits-ui）。组件以 CLI
按需安装、源码落入 `src/lib/components/ui/`；MoonTide 视觉 token 在 `styles.css` 中覆盖，
对齐 Pixel Utility 方向（matte graphite、moss green primary、hard border）。

Workbench 壳层组件（Sidebar、Resizable、Sheet、Dialog 等）随 Workbench 批次按需 `pnpm dlx
shadcn-svelte add …` 引入；Agent 域专用能力（virtual-chat、diff、markdown）作为独立包后置。

前端目录规范（`components / utils / constants / features≈pages / app≈routes`、不设
`stores/`）见 [`../frontend/README.md`](../frontend/README.md)。

以下内容仍不进入当前边界：

- SvelteKit、路由框架和服务端渲染；
- 全局状态管理库；
- 前端持久化 Session 或缓存 Agent facts；
- **CSS 预处理器**（LESS / SCSS / Sass）；样式以 Tailwind v4 + 原生 CSS（`styles.css` token、
  `@layer components`、Svelte scoped CSS）为准。

v0.1 前端采用单页面应用即可。`RenderState`、protocol client 和 view component 分成
清晰模块，但不先抽通用 design-system 或跨产品 frontend package。自研源文件软性控制在
约 **400 行以内**（不含 `*.test.ts`；见 frontend README §1.4）。若后续确实需要 Web 版，再从 UI projection
中抽出可复用部分。

## 4. 被排除的方案

### Iced

放弃作为 MoonTide Desktop 正式 UI 实现。R6 已删除 Iced shell、Rust product RenderState
及 workspace 依赖，不保留兼容层。

### Electron

不采用 bundled Chromium、Node runtime 和更重的桌面运行时形态。Tauri 的 system WebView
并不意味着前端资源、WebView 行为或平台差异免费；这些会进入 D3 验收。

### Slint

保留为历史调研候选，不进入当前实现合约。

### egui / eframe

保留为快速原型或内部诊断工具候选，不作为正式 Desktop UI。

### LESS / SCSS / Sass

v0.1 不引入 CSS 预处理器。自研 UI 使用 Tailwind、`styles.css` 中的 `@layer components`
（`.mt-*` 复合类）与 Svelte 原生 CSS nesting。待 mixin 重复成为真实痛点后再评估 LESS。

## 5. D3 验收边界

D3 的第一条可用切片必须验证：

- Tauri 单窗口启动和关闭；
- Rust bridge 的 command/response 与 protocol event subscription；
- 前端 `RenderState` 对 conversation、assistant snapshot、Tool card、approval、error 的 fold；
- Cmd/Ctrl+Enter、Escape、Stop、approval decision 和关闭取消；
- snapshot/resync、`connection_epoch`、`seq` 和断线提示；
- macOS / Windows / Linux 的 system WebView 启动与文本渲染；
- Tauri API capability 最小化，未授权 command 默认不可调用；
- 不把 UI state、Tauri 类型或 TypeScript 类型泄漏到 `agent` / `agent-core`。

固定内存、磁盘、启动和渲染数字必须通过同一前端实现的可复现实测获得，不能用 Iced、
Electron 或 Tauri 的宣传数字替代 MoonTide 的验收证据。
