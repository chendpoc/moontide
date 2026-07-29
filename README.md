# Oculeau

一个最小可用的 coding agent harness（**TypeScript**）：loop 不变，工具 / 权限 / hooks 外挂；**AgentEvent** 总线供 CLI 与未来 Slint desktop 共用。

## 项目结构

```
oculeau/
├── src/
│   ├── cli/statusline/  # REPL statusline + .oculeau/status.json
│   ├── events/          # AgentEvent bus、orchestrator、CliSink、JsonlSink
│   ├── plugins/         # context / trace 插件（注册 phase slot）
│   ├── context/         # context window 分析（metrics、inspect_context）
│   ├── loop.ts          # agent loop（只调 runPhase）
│   ├── tools.ts         # bash / read / write / edit / glob
│   ├── hooks.ts         # 权限 + audit
│   └── main.ts          # CLI REPL
├── scripts/
│   └── cursor-statusline.ts
├── tests/
└── package.json
```

## 快速开始

```sh
cd oculeau
pnpm install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY

pnpm run ping -- "say hello in one word"
pnpm dev                 # 默认：statusline + stdout 正文（stderr 无 observability 块）
pnpm dev -- --events     # 额外 stdout NDJSON events（供 sidecar / desktop）
```

## AgentEvent 架构

每次 agent run 产生结构化 `AgentEvent`，写入 `.oculeau/events.jsonl`。插件通过 **phase slot** 注册，顺序由 orchestrator 保证：

```
pre_llm:context → post_llm:trace → post_llm:context → post_tool:trace
```

| 通道 | 内容 |
|------|------|
| `conversation` | user_prompt、final |
| `trace` | thinking、tool_use、tool_result |
| `context` | metrics_pre、metrics_post |
| `audit` | tool 审计（jsonl 始终记录；stderr 需显式开启） |

## CLI 模式

| 模式 | 行为 |
|------|------|
| 默认 | statusline 显示四路 OFF；stderr **无** context/trace/events 块；stdout：最终 reply |
| `--events` / `OCULEAU_EVENTS=1` | **额外** stdout NDJSON（含 `conversation/final`） |

### Statusline

每轮 `Oculeau >>` 前显示**一行** statusline（状态变化时才重绘）：

```
Oculeau · deepseek-v4-pro · ~/code/oculeau · idle · ctx OFF · trace OFF · stream OFF · display OFF · turn —
```

状态写入 `.oculeau/status.json`，供 Cursor CLI statusLine 脚本读取。

REPL 命令（**互不排斥，可任意组合**）：

- `/context on|off` — stderr context 盒式指标
- `/trace on|off` — stderr trace 时间线
- `/events on|off` — stdout NDJSON 流
- `/events-display on|off` — stderr EVENT 行（user_prompt / audit）

JSONL / NDJSON 每行事件含可选 `summary`、`displayHint` 字段，便于 grep，不影响机器解析。

## Cursor CLI Statusline

在 `~/.cursor/cli-config.json` 中配置（路径按本机调整）：

```json
{
  "statusLine": {
    "type": "command",
    "command": "tsx /path/to/oculeau/scripts/cursor-statusline.ts"
  }
}
```

脚本合并 Cursor stdin payload（model、context_window%）与 `.oculeau/status.json` 中的 Oculeau 通道开关。

## 环境变量

| 变量 | 作用 |
|------|------|
| `OCULEAU_CONTEXT_DISPLAY=1` | stderr context 盒式输出（**显示开关**） |
| `OCULEAU_CONTEXT_VERBOSE=1\|2` | display ON 时的详略（breakdown 等） |
| `OCULEAU_CONTEXT_VERBOSE_DETAIL=1` | tool_result 多行展开 |
| `OCULEAU_TRACE=1` | stderr trace 时间线 |
| `OCULEAU_EVENTS_DISPLAY=1` | stderr EVENT 行 |
| `OCULEAU_EVENTS=1` | stdout NDJSON event stream |
| `OCULEAU_EVENTS_LOG` | events jsonl 路径（默认 `.oculeau/events.jsonl`） |
| `OCULEAU_CONTEXT_LOG` | context 报告 jsonl（仍双写） |

> `OCULUS_*` 仍可读（deprecated），请迁移到 `OCULEAU_*`。`OCULEAU_CONTEXT=1` 等价于 `OCULEAU_CONTEXT_DISPLAY=1`。

## 测试

```sh
pnpm test
pnpm typecheck
```

## Phase 2（计划）

Slint desktop sidecar 读取 `pnpm dev -- --events` 的 NDJSON，Chat + Trace 多 tab UI。
