# Builtin tools

本目录是 MoonTide **内置 tool** 的实现与声明。

## 文档索引

| 文档 | 内容 |
|------|------|
| [AGENTS.md §2.1](../../../AGENTS.md#21-声明与实现分离spec--impl-split) | Spec / Impl **通用原则**（全仓库） |
| **本文** | 本目录**操作说明**（怎么加 tool） |
| [plugins/builtin/README.md](../../plugins/builtin/README.md) | 可选 plugin tool（`code_repl`、`deep_research`） |
| [docs/README.md](../../../docs/README.md) | 全仓库 Doc Map |
| [register-defaults.ts](../register-defaults.ts) | 默认 manifest 聚合 |

## 目录结构

按**域（domain）**分目录；每个域至少两个文件：**impl** + **`tools.ts`（spec 聚合）**。

```
builtins/
  workspace/          # 文件读写、glob、list_dir
    fs.ts
    tools.ts
  shell/
    bash.ts
    tools.ts
  search/
    grep.ts
    tools.ts
  network/
    http-fetch.ts
    tools.ts
  git/
    lib.ts
    tools.ts
  interaction/
    ask-user-question.ts
    tools.ts
  context/            # inspect_context
    inspect-context.ts
    tools.ts
```

| 文件 | 职责 | 不得包含 |
|------|------|----------|
| **impl**（`runXxx.ts`、`lib.ts`、`fs.ts` …） | IO、算法、错误处理；export `runXxx` / 共享 helper | `ToolSpec`、`defineTool(s)`、manifest 工厂 |
| **`tools.ts`** | `ToolSpec[]`、`defineXxxTools(): ToolDefinition[]` | `spawn`、直接 FS/网络副作用（`run:` 里只调 impl） |

域内只有一个 tool 时**仍保留** `tools.ts` + impl 文件，不写成单文件 monolith。

## 域一览

| 域 | 工厂 | Tools |
|----|------|-------|
| `workspace` | `defineWorkspaceTools` | `read_file`, `write_file`, `edit_file`, `glob`, `list_dir` |
| `shell` | `defineShellTools` | `bash` |
| `search` | `defineSearchTools` | `grep` |
| `network` | `defineNetworkTools` | `http_fetch` |
| `git` | `defineGitTools` | `git_status`, `git_diff`, `git_log`, `git_summary` |
| `interaction` | `defineInteractionTools` | `askUserQuestion` |
| `context` | `defineContextTools` | `inspect_context` |

可选 plugin tool（`code_repl`、`deep_research`）见 [plugins/builtin/README.md](../../plugins/builtin/README.md)。

## 新增 tool checklist

1. **选域** — 与现有域职责一致则放入该域；新域则新建 `builtins/<domain>/`。
2. **impl** — 在域内新增或扩展 impl 文件，export `runXxx(...)`；预期失败用 `toolFailureMessage(toMessage(err))` 或 JSON `{ error }`，热路径不 throw（见 [AGENTS.md §8](../../../AGENTS.md#8-错误边界与排查)）。
3. **`tools.ts`** — 追加 `ToolSpec`：`name` 对齐 [`names.ts`](../names.ts)；声明 `permission`、`capability`、`input_schema`；`run` 只委托 impl。
4. **`names.ts`** — 新增 canonical name 常量。
5. **权限表** — 更新 [`permission-table.ts`](../permission-table.ts)、[`capability-table.ts`](../capability-table.ts)。
6. **注册** — 新域时在 [`register-defaults.ts`](../register-defaults.ts) 增加 `*_TOOL_MANIFEST` 并并入 `BUILTIN_TOOL_MANIFEST`。
7. **测试** — impl：`tests/<domain>.test.ts`；注册：[`tests/conformance/tool-permissions.test.ts`](../../../tests/conformance/tool-permissions.test.ts)（`pnpm test:conformance`）。

## 命名与 import

- impl 函数：`run<PascalCase>`（如 `runGrep`、`runInspectContext`）。
- 工厂函数：`define<Domain>Tools()`，返回 `ToolDefinition[]`（不用 `defineXxxTool()` 单数形式）。
- 跨域复用：路径安全等从 `workspace/fs.ts` 引入 `safePath`。
- impl 内 import 层级：`../../../` 到 `config`、`utils`、`errors` 等。

## Conformance

[`tests/conformance/architecture-boundaries.test.ts`](../../../tests/conformance/architecture-boundaries.test.ts) 扫描本目录 impl 文件：不得含 `ToolSpec` / `defineTool(s)`；不得 export 单数 `defineXxxTool()`。详见 [AGENTS.md §2.1](../../../AGENTS.md#21-声明与实现分离spec--impl-split)。

## 相关代码

| 文件 | 作用 |
|------|------|
| [`define-tool.ts`](../define-tool.ts) | `ToolSpec`、`validateToolSpec`、`defineTools` |
| [`register-defaults.ts`](../register-defaults.ts) | 默认 tool manifest |
| [`execute.ts`](../execute.ts) | Harness 侧 `executeTool` |
