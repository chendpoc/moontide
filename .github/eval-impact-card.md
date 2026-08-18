# Feature Eval Impact Card

复制到 feature PR 描述，或链到本文件。历史详设：[`agent-eval-roadmap.md`](../docs/archive/notes/evals/agent-eval-roadmap.md) §6；Rust 评测路线以根 `TODO.md` 为准。

## Hypothesis

<!-- 本 feature 假设提升什么？例如：deep_task 协议遵循、context 召回 -->

## Primary metric

| 字段 | 值 |
|------|-----|
| **featureSurface** | `tooling` / `deep_protocol` / `context` / `prompt` / `model_only` |
| **Primary 指标** | `meanScore`、`byCategory.<cat>.meanScore`、`liftAlerts` 为空 |
| **Baseline sha** | `main` @ `<git sha>` 或 `--baseline-from=packages/evals/baseline.json` |

## Guard metrics

| Guard | 阈值 / 期望 |
|-------|-------------|
| `v2/regression` | 无 `regressionAlerts`（任一 pair score ≤ 2） |
| `model_only` | 均分 ≥ 3.0，无意外 tool 调用回归 |
| `efficiency` | candidate `meanToolCalls` / token 增幅可接受（PR 中说明） |
| L0 / L1 CI | `pnpm test` + `pnpm eval:test` 绿 |

## 命令

```bash
# PR 默认入口：regression guard → primary，进度日志 + merge-gate + impact snippet
pnpm eval:feature -- --feature-surface=deep_protocol --agent-concurrency=4
pnpm eval:feature -- --list-surfaces
pnpm eval:summarize   # 查看最新 run 摘要
```

跑完后 primary artifact 目录会生成 `impact-snippet.md`，可直接贴进 PR。

`--merge-gate` 失败条件（exit 1）：`meanScore < 3.5`、存在 `regressionAlerts` 或 `liftAlerts`。

<details>
<summary>Debug（低层 CLI，非 PR 默认）</summary>

```bash
pnpm eval -- v2/deep_task --feature-surface=deep_protocol --merge-gate --verbose
pnpm eval -- v2/regression --merge-gate
pnpm eval -- v2/deep_task --write-baseline=packages/evals/baseline.json
pnpm eval -- v2/deep_task --baseline-from=packages/evals/baseline.json --merge-gate
```

</details>

## 结果摘要

| 指标 | Baseline | Candidate | Delta |
|------|----------|-----------|-------|
| meanScore | | | |
| winRate | | | |
| byCategory（主桶） | | | |
| liftAlerts | | | |
| regressionAlerts | | | |

产物路径：`packages/evals/runs/<timestamp>_<id>/report.json`

## 结论

- [ ] Primary 提升，guard 未回归 → 倾向合并
- [ ] Primary 升、guard 降 → 文档标注适用桶或默认 flag off
- [ ] 未达 primary → 不合并或缩小 scope
