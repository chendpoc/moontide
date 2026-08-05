# MoonTide 分段日志存储

> 完整 TODO：[`TODO.md`](../../TODO.md) · Doc Map：[`docs/README.md`](../README.md)

## 已确定设计

```text
<workspace>/.moontide/
├── runs/
│   ├── <runId>-0001.jsonl.gz
│   └── <runId>.active.jsonl
└── status.json
```

- 每个 run 独立存储，不在落盘事件中复制此前 conversation context。
- active JSONL 达到 5 MiB 前按完整行轮转。
- sealed segment 使用 gzip level 2 无损压缩。
- 单条落盘事件最多 64 KiB，并记录截断状态与原始大小。
- run 完成时压缩最后一个 active segment。
- 最多保留 20 个 completed runs，压缩历史总量不超过 20 MiB。
- Rust UI 只 tail 当前 active segment，不读取 gzip 历史。
- 旧日志保留但不再读取或继续写入。

## 当前非目标

- gzip 历史浏览器或 run replay。
- 配置化阈值与保留规则。
- 数据库、WAL、后台 compactor 或 cleanup daemon。
- active segment 原地 compact。
- privacy/redaction policy。

事件字段、恢复流程和 retention 规则见 [`agent-events.md`](../spec/agent-events.md)。

## CLI 双轨

- **TypeScript**（`pnpm dev`）：完整 REPL、Agent Event JSONL、Session Item Log + Index（`/save` · `/resume session`）、statusline、built-in plugins；observability 含 `/thinking`、`/verbose`、`/debug`。
- **Rust R0**（`cargo run -p moontide-cli -- --workdir .`）：native loop + Session JSONL + builtins；observability 为 stderr trace（`/thinking`、`/verbose`），无 Agent Event pipeline。
