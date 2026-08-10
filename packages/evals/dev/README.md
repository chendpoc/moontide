# `@moontide/evals` dev scripts

手工 / debug 工具，**不在 CI 默认路径**。流程入口见 [`../scripts/`](../scripts/)。

| 命令 | 作用 |
|------|------|
| `pnpm eval:summarize` | 打印最新（或指定）`runs/*/report.json` 摘要 |
| `pnpm eval -- …` | 低层 CLI |
| `pnpm eval:feature -- --feature-surface=…` | PR 编排（guard + primary） |

```bash
# 最近一次 run
pnpm eval:summarize

# 指定目录
pnpm exec tsx --tsconfig ../../tsconfig.dev.json dev/summarize-run.ts packages/evals/runs/2026-08-10_13-37-29_0748
```
