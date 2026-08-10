# Feature Eval Impact Card

复制到 feature PR 描述，或链到本文件。详设：[`docs/notes/agent-eval-roadmap.md`](../docs/notes/agent-eval-roadmap.md) §6。

## Hypothesis

<!-- 本 feature 假设提升什么？例如：deep_task 协议遵循、context 召回 -->

## Primary metric

| 字段 | 值 |
|------|-----|
| **Suite** | `v2/<category>` 或 `v2` 全量 |
| **featureSurface** | `tooling` / `deep_protocol` / … |
| **Primary 指标** | `meanScore`、`byCategory.<cat>.meanScore`、`liftAlerts` 为空 |
| **Baseline sha** | `main` @ `<git sha>` 或 `--baseline-from=packages/evals/baseline.json` |

## Guard metrics

| Guard | 阈值 / 期望 |
|-------|-------------|
| `regression` | 无 `regressionAlerts`（任一 pair score ≤ 2） |
| `general` / `model_only` | 均分 ≥ 3.0，无意外 tool 调用回归 |
| `efficiency` | candidate `meanToolCalls` / token 增幅可接受（PR 中说明） |
| L0 / L1 CI | `pnpm test` + `pnpm eval:test` 绿 |

## 命令

```bash
# 与 feature 相关的面 + regression guard
pnpm eval -- v2/deep_task --feature-surface=deep_protocol --merge-gate
pnpm eval -- v2/regression --merge-gate

# 写 baseline / 对比 delta
pnpm eval -- v2/deep_task --write-baseline=packages/evals/baseline.json
pnpm eval -- v2/deep_task --baseline-from=packages/evals/baseline.json --merge-gate
```

`--merge-gate` 失败条件（exit 1）：`meanScore < 3.5`、存在 `regressionAlerts` 或 `liftAlerts`。

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
