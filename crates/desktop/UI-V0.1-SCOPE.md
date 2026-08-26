# Desktop v0.1 UI Scope

> **性质：** v0.1 布局与 core feature 定稿清单（实施门禁）
> **状态：** Proposal；定稿前不启动 Panel Host 以外的 Workbench 大批量编码
> **交互契约：** [`UI-INTERACTION.md`](UI-INTERACTION.md)（详细行为）
> **状态 fold：** [`UI-STATE.md`](UI-STATE.md)
> **产品基线：** [`../../docs/product/desktop-development-direction.md`](../../docs/product/desktop-development-direction.md)
> **工程计划：** [`../docs/desktop-stack-simplification-refactor.md`](../docs/desktop-stack-simplification-refactor.md)

本文把 v0.1 Workbench 收成 **一页 scope**：哪些 layout 区域进版、哪些 core feature 必须闭环、哪些明确不做。冲突时 [`UI-INTERACTION.md`](UI-INTERACTION.md) 仍是交互细节权威；本文只管 **范围裁剪与实施顺序**。

---

## 1. 定稿目标

用户能在单窗口内完成：

```text
启动 →（可选）选/建 Session → 对话 → 看 tool/approval 状态 → 批准或停止 → 断线/resync 可理解
```

不要求：可拖拽分屏、多 Session 并行、Settings UI、独立 agent-host 进程。

---

## 2. Layout（空间结构）

### 2.1 目标线框（与 UI-INTERACTION 一致）

```text
┌──────────────────────────────────────────────────────────────┐
│ TopBar                                                       │
├──────────┬───────────────────────────────┬───────────────────┤
│ Session  │ Conversation                  │ Inspector         │
│ Rail     │  + Composer（贴底）            │ （可折叠）         │
└──────────┴───────────────────────────────┴───────────────────┘
```

实现方式 v0.1：**固定 CSS Grid**，不用 layout engine（dockview / paneforge 等）。

### 2.2 区域 scope 表

| 区域 | 建议 v0.1.0 | 说明 | 定稿 |
|------|-------------|------|------|
| **TopBar** | 进 | workspace 路径缩写、Session 标题、`DesktopRunState`、连接状态 | ☐ 确认 |
| **TopBar · Settings** | **不进** v0.1.0 | 继续 `.env` / 环境变量；Settings UI 归 D5 | ☐ 确认 |
| **TopBar · Inspector 开关** | 进 | 控制右栏显隐；与 Esc 关闭 Inspector 一致 | ☐ 确认 |
| **Session Rail** | **分期** | 见 §2.3 | ☐ 确认 |
| **Conversation** | 进 | 流式 draft、终态 message、tool 简略 card、错误 notice | ☐ 确认 |
| **Composer** | 进 | 多行、Cmd/Ctrl+Enter、Stop、失败保留输入 | ☐ 确认 |
| **Inspector** | **简化版进** | 见 §2.4 | ☐ 确认 |

### 2.3 Session Rail：两个可选定稿方案

**方案 A（推荐，与 UI-INTERACTION 一致）— v0.1.0 含 Rail**

- `New session`、`Recent` 列表（标题、时间、cwd 缩写）
- `Idle` 时切换；运行中点击他 Session → 提示「Turn 运行中」
- 依赖：Host 已有 `SessionQuery` + `StartSession { existing }`；**不扩 wire v1**

**方案 B — v0.1.0 仅单 Session，Rail 推到 v0.1.1**

- 启动即 `StartSession { new }`；无列表、无切换
- 需修订：在 UI-INTERACTION 标注 Rail 为 v0.1.1，或接受文档滞后

**建议：** 方案 A；Rail 可先做窄栏 + 最小列表，不做 Search。

### 2.4 Inspector：两个可选定稿方案

**方案 A（推荐）— 简化 Inspector 进 v0.1.0**

| 能力 | v0.1.0 | 后置 |
|------|--------|------|
| 右栏可折叠 | 是 | — |
| 点击 tool card → 详情（参数、结果、status） | 是 | — |
| 点击 approval → 详情 + Allow/Deny | 是（Conversation 可保留快捷按钮） | — |
| Thinking 详情 | 可选：仅 draft 内折叠块 | 完整 Inspector 专页 |
| Diagnostics（delivery、resync） | 是 | Agent Event Log 浏览器 |
| Inspector 选中态 | UI local state，**不进 RenderState** | — |

**方案 B — v0.1.0 无独立 Inspector**

- 全部内联在 Conversation；与 UI-INTERACTION「对话中心 Workbench」定位不一致
- 仅当产品改名为「Conversation MVP」时采用

**建议：** 方案 A；Thinking 完整页可标 v0.1.1。

---

## 3. Core features（v0.1.0 必须闭环）

### 3.1 已在 D3-PF（保持不回退）

- [x] protocol → RenderState fold（draft 替换、finalized、tool、approval）
- [x] Tauri bridge + controller（handshake、resync、send/cancel/approve）
- [x] 最小 Conversation + Composer + Stop + 内联 approval
- [x] Host：单 Session、单 Turn、ApprovalBroker、关闭清理

### 3.2 v0.1.0 待完成（P0）

| ID | Feature | Owner | 验收 |
|----|---------|-------|------|
| F1 | **Panel Host 最小壳** | frontend | `PanelInstance` + 固定 grid 挂载 Conversation / Inspector |
| F2 | **Workbench 三区布局** | frontend | TopBar + 三列；Composer 贴 Conversation 底 |
| F3 | **Inspector 简化版** | frontend | 开/关、tool/approval 选中详情；不改变 Host 事实 |
| F4 | **Session Rail**（若 §2.3 选 A） | frontend + 现有 Host API | 列表、切换、Busy 提示 |
| F5 | **Composer 输入保留** | frontend | 发送失败、resync 不丢未提交文本 |
| F6 | **Provider 流式 smoke** | 集成 | 真实 API 下 draft 更新与 final 一致 |

### 3.3 明确不进 v0.1.0

| 项 | 归属 |
|----|------|
| Layout engine（拖拽 split、tab dock） | Workspace / v0.2+ |
| 多 Session 并行、后台 Turn | P2 / scheduler |
| Settings UI、workspace 切换 UI | D5 |
| agent-host 独立进程 | D4 |
| Fleet / 灵动岛 / Tide / Buoy | [`workspace-product-direction.md`](../../docs/product/workspace-product-direction.md) |
| Thinking 完整 Inspector 页、Agent Event 浏览器 | v0.1.1+ |
| Session Search、fork/branch | P1 |

---

## 4. 四层栈与缺口（定稿后填什么）

```text
desktop::wire（合并后）  ← R2 结构精简，不改 JSON v1
Desktop Server（desktop） ← v0.1 基本不动
RenderState + controller ← 已有；F5 等细项
Panel Host + Panel 视图  ← F1–F3 主战场
Layout Engine            ← 明确不做（固定 grid）
```

---

## 5. 推荐实施顺序

与 [`desktop-stack-simplification-refactor.md`](../docs/desktop-stack-simplification-refactor.md) 对齐：

| 步 | 内容 | 产出 |
|----|------|------|
| 0 | **本文定稿**（§2、§3 打勾） | 锁定 v0.1.0 scope |
| 1 | 合并 `desktop-protocol` → `desktop::protocol` | 结构精简（已完成） |
| 2 | 文档 + fixture + 测试路径售后 | 无行为变更 |
| 3 | Panel Host + WorkbenchLayout（固定 grid） | F1、F2 |
| 4 | Inspector 简化版 | F3 |
| 5 | Session Rail（若选定方案 A） | F4 |
| 6 | Composer 保留 + UI-INTERACTION 验收清单 | F5 |
| 7 | Provider smoke | F6 |
| — | Layout engine | 不做 |

---

## 6. v0.1.0 验收 checklist

实施完成后逐项勾选：

**Layout**

- [ ] TopBar 显示 run state（来自 `DesktopRunState`，非文本推断）
- [ ] 三列 Workbench 可见；Inspector 可折叠
- [ ] Composer 固定 Conversation 底部

**Conversation**

- [ ] 流式 assistant 同一 bubble 替换，非多条 snapshot message
- [ ] Tool 简略 card；终态 message 与 Session 恢复一致

**Inspector（若启用）**

- [ ] 选中 tool 显示参数与 result
- [ ] 选中 approval 可 Allow/Deny；关闭 Inspector 不影响 pending 可见性（TopBar/Conversation）

**Session（若启用 Rail）**

- [ ] New / 切换 Recent；运行中切换被阻止并提示

**生命周期**

- [ ] Stop / Esc 取消 Turn
- [ ] 窗口关闭：cancel → await → shutdown
- [ ] 断线/resync：UI 进入 degraded/disconnected，recovery 可理解

**工程**

- [ ] `just check` 通过
- [ ] 至少一条真实 provider 流式 smoke

---

## 7. 定稿记录

| 日期 | 决策 | 签字 |
|------|------|------|
| | §2.3 Session Rail：方案 A / B | |
| | §2.4 Inspector：方案 A / B | |
| | §2 TopBar Settings 不进 v0.1.0 | |

定稿后更新本文 **状态** 为 `Confirmed baseline`，并在 [`TASKS.md`](TASKS.md) 增 R-simplify / v0.1.0 批次勾选项。
