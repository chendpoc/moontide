# 扩展生态兼容策略

> **文档性质：** notes（兼容承诺，非 Spec）  
> **Hook 机制：** [`agent-run-hooks.md`](agent-run-hooks.md) · **加载实现：** [`plugin-host.md`](plugin-host.md) · **平台：** [`platform-strategy.md`](../product/platform-strategy.md)

MoonTide 与 Codex / Claude Code 同属 **native camp**（Rust CLI、无 embedded Node）。兼容重点是 **用户已有配置与 MCP 工具**，不是 Pi/OpenCode in-process 插件 API。

---

## 1. 承诺分层

| 层级 | 兼容对象 | 机制 | Release 阶段 | 承诺 |
|------|----------|------|--------------|------|
| **P0** | MCP 工具 server | L1 stdio / HTTP · `tools/list` · `tools/call` | R2 | **一等公民** |
| **P0** | 项目指令 | `AGENTS.md` · `CLAUDE.md` · `.moontide/rules` → Instruction State | R1–R2 | **内容兼容** |
| **P0** | MCP 配置习惯 | `.moontide/plugins.toml` · `/mcp add` · startup/runtime attach | R2 | **形态对齐** |
| **P1** | Codex lifecycle hooks | shell + JSON · `PreToolUse` / `PostToolUse` · proceed/block/modify | R2–R3 | **协议兼容** |
| **P1** | Codex Plugin 包 | 拆层导入 manifest（见 §2） | R3 | **部分导入** |
| **P1** | Claude Code hooks | 与 Codex 同族 adapter | R3 | **尽力兼容** |
| **P2** | Skills（Cursor/Codex） | `SKILL.md` → Instruction 或 sidecar | R3+ | 格式只读 |
| **P2** | Pi ExtensionAPI | L3 `pi-compat` sidecar 适配 | R4+ | 非零改 |
| **P2** | OpenCode plugins | L3 社区 adapter → MCP/sidecar | R4+ | 官方不维护 |
| **不做** | VS Code Extension API | — | — | 编辑器生态 |
| **不做** | Pi/OpenCode in-process | — | — | 与 Rust release 互斥 |

---

## 2. Codex Plugin 包字段映射

`.codex-plugin/plugin.json` 拆层接入，不要求目录 100% 相同：

| Manifest 字段 | MoonTide 接入 |
|---------------|------------|
| `mcpServers` / `.mcp.json` | Plugin host L1 attach |
| `skills/` | Instruction State 加载 |
| `hooks` / `hooks/hooks.json` | HookDispatcher（shell 或 sidecar） |
| `apps` | 待定（通常仍映射 MCP 连接） |

Plugin hook 环境变量：支持 `PLUGIN_ROOT`；可选兼容 `CLAUDE_PLUGIN_ROOT`。

---

## 3. 三种 Plugin 运行时

| 形态 | 进程 | npm | 用于 |
|------|------|-----|------|
| **A. MCP** | 每 server 一进程 | 在 server 内 | 纯 tool（**优先**） |
| **B. Sidecar** | 单常驻 Node | 完整 | hook + npm 深度集成 |
| **C. Shell hook** | 短生命周期 | 脚本内可选 | Codex/Claude 兼容 |

**规则：** 能 MCP 的 tool 优先 MCP；要 lifecycle hook 走 Sidecar（B）。

Plugin Runtime Pack 按需下载，不进主 binary。见 [`runtime-multilang.md`](runtime-multilang.md) §9。

---

## 4. 与 platform L1/L2/L3 对齐

| platform 层 | compat 层 | 说明 |
|-------------|-----------|------|
| **L1 MCP** | P0 | 默认扩展面 |
| **L2 MoonTide Plugin SDK** | P1 sidecar + P2 pi-compat | 自有 NDJSON 协议 |
| **L3 Adapter** | P2 | 社区包装，不承诺零改 |

---

## 5. 产品定位（诚实边界）

**适合宣传：**

- MCP 工具与 Codex/Claude 同类 server 互通
- `AGENTS.md` / 项目 rules 直接生效
- Codex 系 hooks / plugin 配置可迁移

**不适合宣传：**

- 插件生态最全
- Pi/OpenCode 插件零改
- 任意 `npm install` 进 agent core

---

## 6. 相关文档

| 文档 | 关系 |
|------|------|
| [`agent-run-hooks.md`](agent-run-hooks.md) | phase · dispatch · sidecar |
| [`plugin-host.md`](plugin-host.md) | attach · manifest |
| [`context-analysis.md`](context-analysis.md) | 竞品 context（非 plugin） |
