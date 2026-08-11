# @moontide/evals

MoonTide harness **feature A/B evaluation**（真 LLM + pairwise judge）。Spec: [`docs/spec/harness-eval-1.0.md`](../../docs/spec/harness-eval-1.0.md) · 分类设计: [`docs/notes/evals/agent-eval-task-taxonomy.md`](../../docs/notes/evals/agent-eval-task-taxonomy.md) · **L2 agent artifact 计划:** [`docs/notes/evals/eval-release-artifact.md`](../../docs/notes/evals/eval-release-artifact.md) · PR 模板: [`.github/eval-impact-card.md`](../../.github/eval-impact-card.md)。

## 原则

- **真 LLM** 跑完整 harness（`AgentSession.run`）
- **Pairwise judge**：同题 baseline vs candidate，1–5 分 + rationale
- **`gradingMode`**：`objective`（expectedChecks）| `subjective`（LLM 对比 + rubricBullets）
- 主指标：**meanScore**、**winRate**、**byCategory**、**byFeatureSurface**、**efficiency**
- Agent job 在**子进程**中跑（每题 baseline+candidate 隔离）

## 依赖

| 包 | 用途 |
|----|------|
| `@moontide/agent` | Harness run（`AgentSession` · `setupEvalHarness` · `loadWorkspaceEnv`） |
| `@moontide/agent/testing` | eval overrides · mock pipeline |
| `@moontide/llm` · `@moontide/session` · `@moontide/tools` · `@moontide/log` · `@moontide/shared` | harness 链路透传 |

**不依赖** `@moontide/agent-cli`（无 REPL / stderr 渲染）；workspace `.env` 经 `@moontide/agent/load-env` 的 `loadWorkspaceEnv` 加载（避免 bootstrap 时拉整包 `@moontide/agent` 主入口）。

## 命令

| 层 | 命令 | 说明 |
|----|------|------|
| **L0** | `pnpm check` | lint + typecheck + test + `eval:test`（单测） |
| **L1** | `pnpm eval:l1` | mock LLM agent-only + protocol 检查（无 API key） |
| **L2** | `pnpm eval:feature` | 真 LLM A/B + judge（opt-in） |

```bash
# L1 mock（无 API key）
pnpm eval:l1

# L2 PR 编排（guard regression + primary suite，带进度日志 + impact snippet）
pnpm eval:feature -- --feature-surface=deep_protocol --agent-concurrency=4 --verbose
pnpm eval:feature -- --list-surfaces
pnpm eval:feature -- --help
pnpm eval:summarize                      # 打印最新 runs/*/report.json

# 在 packages/evals 目录内（pnpm --filter @moontide/evals）
pnpm test                                # = 根目录 eval:test
pnpm test:integration                    # = 根目录 eval:integration
```

### 目录

| 路径 | 用途 |
|------|------|
| `scripts/run-evals.ts` | 低层 CLI 入口 |
| `scripts/run-feature-pr.ts` | PR 编排（guard → primary） |
| `scripts/run-agent-job.ts` | 子进程 worker |
| `dev/` | 手工 debug 脚本（见 [`dev/README.md`](dev/README.md)） |
| `src/` | 库逻辑 |
| `tests/` | vitest 单测 |

| 参数 | 作用 |
|------|------|
| `--case-id=` | 精确单题 |
| `--case=` | id 子串过滤 |
| `--feature-surface=` | 按 harness 能力面过滤 |
| `--agent-concurrency=N` | agent 并行度（1–10，默认 4；子进程） |
| `--judge-mode=single\|batch` | single → batch=1 |
| `--judge-batch=N` | batch 模式下每批条数 |
| `--agent-only` | 只跑 baseline/candidate harness |
| `--judge-only --judge-from=` | 只 judge，不重跑 agent |
| `--baseline-from=` | 与 `baseline.json` 对比 delta |
| `--write-baseline` | 写入 `packages/evals/baseline.json` |
| `--merge-gate` | meanScore / regression / lift 门禁（exit 1） |
| `--verbose` | 转发子进程 stderr（`[eval:job:<case-id>]`） |
| `--record-http-fixtures` | external_research 录制 HTTP 快照 |
| `--harness-config=` | JSON 文件覆盖 baseline/candidate 配置 |

产物：`packages/evals/runs/<YYYY-MM-DD_HH-mm-ss_ssRR>/`（`pairs.jsonl`、`report.json`、`impact-snippet.md`（feature-pr）、session/debug 副本）

### feature-pr 参数

| 参数 | 作用 |
|------|------|
| `--feature-surface=` | **必填**；见 `--list-surfaces` |
| `--list-surfaces` | 打印 surface → primary suite 映射 |
| `--help` | 用法 |
| `--log=` | stderr tee 到文件（默认 `runs/feature-pr_<surface>_<ts>.log`） |
| `--no-write-impact` | 不写 `impact-snippet.md` |
| `--repetitions=N` | 每题重复次数（默认 1） |

### 低层 CLI

```bash
pnpm eval -- v2/coding
pnpm eval -- v2/deep_task --feature-surface=deep_protocol
pnpm eval -- v2/external_research --case-id=ext-capital-api
pnpm eval -- v2                          # 六类全量（58 case）
pnpm eval:test                           # 单元测试（无真 LLM）
pnpm eval:integration                    # examples/ 真 LLM smoke（需 API key）
```

> `pnpm eval:pr` 是 `eval:test` 的别名（L0 单测门禁），不是 PR 真 LLM 编排；PR L2 用 `eval:feature`；mock 协议跑通用 `eval:l1`。

## Case 格式（`cases.jsonl` 一行）

```json
{
  "id": "coding-tool-grep-secret",
  "category": "coding",
  "gradingMode": "objective",
  "featureSurface": ["tooling"],
  "steps": [{ "type": "prompt", "content": "Use grep to find ..." }],
  "expectedChecks": [
    { "kind": "tool_called", "name": "grep" },
    { "kind": "reply_contains", "value": "secrets.ts" }
  ]
}
```

`featureSurface`：`tooling` | `prompt` | `context` | `deep_protocol` | `model_only`

`expectedChecks` 扩展：

| kind | 作用 |
|------|------|
| `tool_called` | 必须调用指定 tool |
| `tool_min_count` | 最少 tool 调用次数 |
| `work_mem_used` | deep 题：须写入 work_mem |
| `file_contains` / `reply_*` | 文件与回复断言 |

`category`：`coding` | `exploration` | `deep_task` | `general` | `regression` | `external_research`

## 习题集

### v2 standard（`cases.jsonl` + fixture 目录）

```
suites/v2/coding/
  cases.jsonl
  fixtures/<case-id>/...

suites/v2/exploration/
  cases.jsonl
  workspace/          # 整类共用 mini-repo

suites/v2/external_research/
  cases.jsonl
  fixtures/<case-id>/http/recordings.json   # VCR 快照
```

| 目录 | 题数 | 侧重 | fixture |
|------|------|------|---------|
| `v2/coding/` | 10 | tool、context、改文件 | `fixtures/<id>/` |
| `v2/exploration/` | 10 | grep/glob/list_dir | `workspace/` |
| `v2/deep_task/` | 10 | deep + work_mem | `fixtures/<id>/` |
| `v2/general/` | 10 | model_only guard | 无 |
| `v2/regression/` | 8 | guard + smoke | `fixtures/<id>/` |
| `v2/external_research/` | 10 | http_fetch + 国内 API | `fixtures/<id>/http/` |

**external_research** 题面用真实 URL（npmmirror、Gitee API、Bilibili；POST/HTML 用 httpbin），CI 走 **offline replay**（`recordings.json`）。重录：`pnpm eval -- v2/external_research --record-http-fixtures --agent-only`。

`expectLift: true` 标注在 deep 协议题（baseline 关 reminder 时应弱于 candidate）。

元数据：`suites/v2/manifest.json`。

全量 **58 case**：`pnpm eval -- v2` 或按 category / `--feature-surface` 分批。

### v1 smoke（legacy 单 JSON）

| 文件 | category | 题数 |
|------|----------|------|
| `A-coding-smoke.json` | coding | 10 |
| `D-exploration-smoke.json` | exploration | 10 |
| `B-deep-protocol.json` | deep_task | 10 |
| `C-general-knowledge-smoke.json` | general | 10 |
| `E-regression.json` | regression | 10 |

v1 仅作 harness 调试；新题写入 v2 `cases.jsonl`。

## Baseline vs Candidate

```ts
const baseline = createMoonTideEvalHarness({ name: "baseline", disableProtocolReminders: true });
const candidate = createMoonTideEvalHarness({ name: "with-feature" });
await runSuiteAb({ suitePath: "v2/deep_task", featureSurface: "deep_protocol", baseline, candidate, repetitions: 2 });
```

## 与 `tests/` 边界

| | `tests/` | `@moontide/evals` |
|--|----------|-------------------|
| 模型 | mock | **真 LLM** |
| 打分 | assert 机制 | **pairwise judge** |
| CI | `pnpm test` + `pnpm eval:test` | 真 LLM 仅本地 / nightly（`eval:integration`） |
