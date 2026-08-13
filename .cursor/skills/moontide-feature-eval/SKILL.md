---
name: moontide-feature-eval
description: Run MoonTide L2 feature eval (eval:feature), interpret Impact Card, and summarize artifacts. Use when validating a feature PR, running harness A/B eval, or filling eval-impact-card.md.
---

# MoonTide Feature Eval

L2 opt-in eval for feature PRs. **Not** mandatory CI (`pnpm check` / `eval:test` is L0 only).

## When to use

- User asks to run feature eval, eval:feature, or Impact Card for a PR
- Validating `featureSurface` hypothesis before merge
- Summarizing `packages/evals/runs/` artifacts

## Prerequisites

- `DEEPSEEK_API_KEY` or `ANTHROPIC_API_KEY` in `.env` (L2 only; L1 uses mock LLM)
- Valid harness A/B: baseline vs candidate must differ (`model`, `judgeModel`, or `featureToggles`)

## L2 — feature PR eval

```bash
pnpm eval:feature -- --list-surfaces
pnpm eval:feature -- --feature-surface=deep_protocol --agent-concurrency=4 --verbose
```

| Surface | Primary suite | Notes |
|---------|---------------|-------|
| `deep_protocol` | v2/deep_task | Built-in harness diff (protocol reminders) |
| `tooling` | v2/coding | Requires `--harness-config=` with toggle diff |
| `context` | v2/coding | Requires harness config |
| `prompt` | v2/deep_task | Requires harness config |
| `model_only` | v2/general | Requires harness config |

Guard suite is always `v2/regression`.

### Options

- `--merge-gate` (default on): exit 1 if meanScore &lt; 3.5, regressions, or lift alerts
- `--no-merge-gate`: report only
- `--budget-micro-cny=N`: soft API budget (exit 2 if exceeded)
- `--max-cases=N`: cap cases per suite
- `--harness-config=<json>`: explicit baseline/candidate harness

### Exit codes

| Code | Meaning |
|------|---------|
| 0 | Pass |
| 1 | merge-gate failed |
| 2 | budget exceeded |
| 3 | no valid harness A/B diff |

## L1 — mock LLM (no API key)

```bash
pnpm eval:l1
pnpm eval:l1 v2/regression --max-cases=3
```

Runs agent-only with mock LLM; fails on agent errors only.

## After a run

1. Read stderr progress log path (feature-pr) or artifact dir under `packages/evals/runs/`
2. Open `report.json` and `manifest.json` (route, budget, intervention)
3. Paste `impact-snippet.md` into PR if generated
4. Template: [.github/eval-impact-card.md](../../.github/eval-impact-card.md)

## Summarize latest run

```bash
pnpm eval:summarize
```

## Do not

- Use `eval:pr` for L2 (it is `eval:test` alias — unit tests only)
- Expect revision/worktree A/B (removed; use harness toggle only)
- Run full v2 suite on every PR without `--max-cases` or budget

## Reference

- [packages/evals/README.md](../../packages/evals/README.md)
- [docs/notes/agent-eval-roadmap.md](../../docs/notes/agent-eval-roadmap.md)
