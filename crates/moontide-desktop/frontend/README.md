# MoonTide Desktop Frontend

> **性质：** Tauri WebView 前端工程规范与模块化开发流程  
> **契约：** wire 对齐 [`../DESIGN.md`](../DESIGN.md)；UI 产品边界见 [`../docs/UI-V0.1-SCOPE.md`](../docs/UI-V0.1-SCOPE.md)
> **技术栈：** Svelte 5 · TypeScript · Vite SPA · pnpm · shadcn-svelte · Tailwind CSS v4

本目录是 **protocol consumer + view projection**，不拥有 Agent、Session Item Log 或 approval truth。

---

## 0. 常见六目录与 MoonTide 映射

工程上常设 `components / routes / utils / constants / pages / stores`。MoonTide v0.1 是只有 Blank/Loaded 两种 page mode 的 **单窗口 Session Chat client**，不是多 URL SaaS；下表是采纳与等价关系：

| 常见目录 | MoonTide | 说明 |
|----------|----------|------|
| **components** | `src/lib/components/` | `ui/` = shadcn CLI；`moontide/` = 跨 feature 复合组件 |
| **routes** | `src/app/` + `src/main.ts` | v0.1 无 client router；单入口组合根。未来 SvelteKit/深链接再增 `routes/` |
| **utils** | `src/lib/utils/` | 纯函数（`cn`、格式化）；不含 fold / IO |
| **constants** | `src/lib/constants/` | 无行为字面量（协议版本、快捷键名）；wire 类型仍在 `protocol/` |
| **pages** | `src/lib/features/chat/` | Chat feature 内按职责切组件；page mode 由 loaded Session identity 派生 |
| **stores** | `src/lib/controller/` + `src/lib/projection/` | Host 投影与 intent；**不设** 一级 `stores/`。UI-local 用组件 `$state` 或 feature 内模块 |

与 UI 无关、但不可省略的 **domain 层**（不属于上表六类）：

```text
lib/protocol/      wire + zod
lib/projection/    RenderState fold + uiModel
lib/controller/    boot · buffer · resync · send
lib/bridge/        Tauri 适配
```

---

## 1. 目录规范

```text
frontend/
├── README.md
├── components.json
├── styles.css
├── index.html
├── package.json / pnpm-lock.yaml
├── vite.config.ts
├── vitest.config.ts
├── tsconfig.json
├── scripts/
└── src/
    ├── main.ts                 # 入口（≈ routes /bootstrap）
    ├── app/                    # 应用壳（≈ root layout，组合 features）
    │   ├── App.svelte
    │   └── App.test.ts
    └── lib/
        ├── protocol/
        ├── projection/
        ├── controller/         # ≈ stores（Host 投影 + connection）
        ├── bridge/
        ├── constants/
        ├── utils/
        ├── components/
        │   ├── ui/
        │   └── moontide/
        ├── features/           # ≈ pages（v0.1 为 chat）
        └── hooks/
```

### 1.1 模块职责

| 路径 | 职责 | 禁止 |
|------|------|------|
| `app/` | 布局组合、注入 `DesktopControllerPort`、挂载 feature | protocol fold、直接 Tauri |
| `lib/protocol/` | v1 envelope/schema | UI、constants 替代类型 |
| `lib/projection/` | `RenderState` fold、`uiModel` | Tauri、stores 目录 |
| `lib/controller/` | boot、buffer、connection、intent | Svelte 组件 |
| `lib/bridge/` | `DesktopBridge` | fold、UI |
| `lib/constants/` | 跨模块字面量 | 业务逻辑、zod schema |
| `lib/utils/` | 纯工具函数 | domain fold |
| `lib/components/ui/` | shadcn 原子 | 业务语义 |
| `lib/components/moontide/` | 无 IO 复合 UI | protocol command |
| `lib/features/*/` | 产品 feature（≈ pages） | 跨 feature 环依赖 |

### 1.2 Feature 切片（≈ pages，对齐 v0.1 Session Chat）

```text
features/
└── chat/
    ├── ChatShell.svelte
    ├── SessionSidebar.svelte
    ├── ChatTopBar.svelte
    ├── BlankConversation.svelte
    ├── LoadedConversation.svelte
    ├── Composer.svelte
```

`ChatShell` 只根据 view model 选择 Blank/Loaded；feature component 接收 typed callback，不 import Tauri bridge。`chatUiModel` 是 pure derivation，不发送 command。

**命名：** 目录 `kebab-case`；组件 `PascalCase`；TS 模块 `camelCase`。

### 1.3 样式栈（Tailwind + 原生 CSS）

v0.1 **不引入** LESS / SCSS / Sass。现代 CSS + Tailwind 已覆盖当前需求：

| 能力 | 做法 |
|------|------|
| Design token | `styles.css` 的 `:root` / `@theme` CSS 变量 |
| shadcn 原子 | Tailwind utility（`components/ui/`） |
| 自研复用样式 | `styles.css` 的 `@layer components`（如 `.mt-panel`） |
| 组件私有样式 | Svelte `<style>` + **原生 CSS nesting** + `var(--*)` |
| 条件组合 | Tailwind + `cn()` |

```text
styles.css           ← token + @layer base + @layer components（.mt-*）
components/ui/       ← shadcn / Tailwind only
components/moontide/ ← Tailwind + .mt-* 或 scoped CSS
features/            ← 同上
```

**何时再评估预处理器：** 自研组件出现大量跨文件 mixin 重复、且 `@layer` + CSS 函数仍无法 DRY 时，再单独立项引入 LESS（优先）或 Sass。

### 1.4 单文件体积与复杂度（软性 ≤400 行）

目标：**单个生产 `.ts` / `.svelte` 源文件不超过约 400 行**（软性，review 时检查）。**`*.test.ts` 不计入**本限额。目的不是机械拆行，而是控制可读性、测试边界与 merge 冲突面。

| 类型 | 建议 |
|------|------|
| **Svelte 组件**（`app/`、`features/`、`moontide/`） | ≤400 行；超出则拆子组件或 `*Model.ts` |
| **业务 TS**（controller、projection、uiModel、protocol） | ≤400 行；按职责拆模块（如 fold / connection / intent / schema） |
| **components/ui/** | shadcn CLI 产物，**不计入**自研限额 |
| **\*.test.ts** | **不计入**；长度不受 §1.4 约束 |

超出时的拆法（按优先级）：

1. **UI** → 子组件 + feature 目录（对齐 §1.2）
2. **纯函数** → 同层新模块（如 `renderState/foldEvent.ts`）
3. **类型/ schema** → `protocol/types.ts`、`protocol/schema.ts`

当前 `App.svelte` 只负责 Controller 注入、订阅与销毁（约 30 行）；Chat 组件均在
`features/chat/*` 且低于软性限额。`protocol/index.ts`（~404）与 `renderState.ts`（~439）
仍接近或略超限额，等出现可独立验证的边界后再拆分。

`desktopController.ts`（~715）是已确认的软性例外。Session lifecycle、first Send、event buffering、
snapshot establishment 与 resync 共享同一台异步状态机；强行拆成多个对象会造成重复的状态所有权。
只有出现可独立验证的状态边界、第二个消费者或持续的合并冲突时，才重新评估其结构。

### 1.5 文档位置

前端目录规范、模块职责与依赖方向**只写在本文件**。`src/` 下各目录（`app/`、`features/`、
`components/moontide/` 等）**不放** stub `README.md`；那些文件只会复述 §0–§1。

非代码说明放在 crate 文档层：Host/UI 契约在 `../docs/`，crate 入口在 [`../README.md`](../README.md)。
截图 provenance 属于 `../docs/references/`，不属于 `src/`。

---

## 2. 依赖方向

```text
main.ts → app/App.svelte → features/*
features → components/*, projection/uiModel, controller (Port only)
controller → projection, protocol, bridge
projection → protocol
bridge → controller (types), @tauri-apps/api
features ↛ bridge, protocol
constants / utils → 无 upward 依赖（仅被引用）
```

- 不设一级 `stores/`：`view.render` 来自 controller subscribe；见 [`UI-TECH-CHOICE.md`](../docs/UI-TECH-CHOICE.md)。
- `constants/` 准入：≥2 模块使用、无函数行为。

---

## 3. 模块化开发流程

### 3.1 落地顺序

1. **契约** — Rust + `lib/protocol/`
2. **Projection** — `lib/projection/renderState.ts` + 测试
3. **View 派生** — `chatUiModel.ts`
4. **Feature UI** — `lib/features/<slice>/`
5. **App 组合** — 薄化 `app/App.svelte`
6. **验证** — `pnpm test` · `pnpm run check` · `pnpm run build`

### 3.2 shadcn 组件

```bash
pnpm dlx shadcn-svelte@1.5.1 add sidebar tooltip dropdown-menu collapsible skeleton
```

Batch 1 使用并记录 `shadcn-svelte 1.5.1`；禁止使用未记录的 `@latest`。
产物 → `src/lib/components/ui/`。Token 只改 `styles.css`，CLI diff 必须先 review。

### 3.3 测试位置

| 层 | 路径 |
|----|------|
| protocol | `lib/protocol/*.test.ts` |
| projection | `lib/projection/*.test.ts` |
| controller | `lib/controller/*.test.ts` |
| bridge | `lib/bridge/*.test.ts` |
| feature / app | `features/**/*.test.ts`, `app/*.test.ts` |

### 3.4 Session Chat 批次

1. 文档与 contract reset。
2. pnpm/shadcn/theme 基座。
3. Session catalog、first-send 与 generation lifecycle。
4. projection 与 `chatUiModel`。
4. Chat shell、Sidebar 与 Blank。
5. Loaded Conversation。
6. interaction、accessibility 与 visual QA。

精确 gate 见 [`../docs/UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md`](../docs/UI-V0.1-CHAT-IMPLEMENTATION-PLAN.md)。

---

## 4. 本地命令

```bash
pnpm install
pnpm test
pnpm run check
pnpm run build
```

Tauri：`cd ../src-tauri && cargo tauri dev`

---

## 5. Rust 边界

```text
typed Controller intent → typed DesktopBridge method → Tauri command → Host
DesktopMessageEnvelope ← listenEnvelope
desktop-connection ← listenConnection
```

UI-local state 见 [`UI-INTERACTION.md`](../docs/UI-INTERACTION.md)。

---

## 6. 迁移状态

| 项 | 状态 |
|----|------|
| `protocol` / `projection` / `controller` / `bridge` | 已就位 |
| `utils/` / `constants/` | 已就位 |
| `components/ui` | shadcn 基座 |
| `features/chat` | Batch 4 Shell、Sidebar、Blank 与共享 Composer 已实现；Loaded 改版留给 Batch 5 |
| `routes/` / `pages/` / `stores/` | **不建**；用上表映射 |
| 单文件 ≤400 行（软性，不含 `*.test.ts`） | Chat feature 已满足；`desktopController.ts` 为已确认例外，projection/protocol 待出现真实边界后再评估 |
