# Oculus

一个最小可用的 coding agent harness（**TypeScript**）：loop 不变，工具 / 权限 / hooks 外挂。

## 项目结构

```
oculus/
├── src/
│   ├── config.ts      # DeepSeek / 工作区配置
│   ├── llm.ts         # Anthropic SDK client
│   ├── loop.ts        # agent loop 内核
│   ├── tools.ts       # bash / read / write / edit / glob
│   ├── permissions.ts # deny / ask 闸门
│   ├── hooks.ts       # PreToolUse 审计 + 权限
│   ├── prompt.ts      # system prompt
│   ├── context/       # context window 分析（verbose / log / format / inspect）
│   ├── native-tools/  # Node 原生能力（fs 等，供 context log 使用）
│   ├── main.ts        # CLI REPL
│   └── ping.ts        # API 连通测试
├── tests/             # vitest 离线测试
├── legacy/python/     # 旧 Python 实现（归档）
├── package.json
└── tsconfig.json
```

## 快速开始（DeepSeek）

Oculus 通过 **DeepSeek 的 Anthropic 兼容端点** 调用模型。

```sh
cd oculus
npm install
cp .env.example .env   # 填入 DEEPSEEK_API_KEY

npm run ping -- "say hello in one word"
npm run dev            # CLI REPL
```

`.env` 示例：

```env
DEEPSEEK_API_KEY=sk-xxx
MODEL_ID=deepseek-v4-pro
```

## 脚本

| 命令 | 作用 |
|------|------|
| `npm run dev` | 启动 CLI（tsx，开发用） |
| `npm run build` | 编译到 `dist/` |
| `npm start` | 运行编译后的 CLI |
| `npm run ping -- "hi"` | 测试 API 连通 |
| `npm test` | vitest 离线测试 |
| `npm run typecheck` | TypeScript 类型检查 |

## Context 观测

每次 LLM 调用前后自动分析 context window（通过 Hook，不影响 agent loop 结构）：

| 环境变量 | 作用 |
|----------|------|
| `OCULUS_CONTEXT_VERBOSE=1` | stderr 彩色 summary（用量条、headroom、Δ） |
| `OCULUS_CONTEXT_VERBOSE=2` | 额外打印 message struct tree |
| `OCULUS_CONTEXT_VERBOSE_DETAIL=1` | 在 struct tree 下展开 `tool_result` 多行内容（需 `VERBOSE>=2`） |
| `OCULUS_CONTEXT_LOG` | JSONL 日志路径（默认 `.oculus/context.jsonl`） |
| `OCULUS_CONTEXT_SNAPSHOT=1` | 另存每 turn messages 快照 |

Agent 也可调用 `inspect_context` meta-tool 查看当前 context 占用（可选 `exact: true` 走 API 精确计数）。

## 测试

```sh
npm test
npm run typecheck
```

## 与 02-agent-basic 的关系

- **Labs / my-mini-agent**：按章节练习（Python）
- **Oculus**：你的真实产品（TypeScript），直接迭代

## 下一步

- [ ] s05 — `todo_write` 多步规划
- [ ] s09 — `MEMORY.md` 跨会话记忆
- [ ] s19 — MCP 插件
- [ ] HTTP `/chat` + 部署
