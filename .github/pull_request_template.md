## Summary

<!-- What changed and why -->

## Eval Impact

Feature PRs that touch agent harness, tools, context, or prompts should complete the [Eval Impact Card](.github/eval-impact-card.md).

| Field | Value |
|-------|-------|
| **featureSurface** | <!-- tooling / deep_protocol / context / prompt / model_only --> |
| **L2 eval** | <!-- opt-in: `pnpm eval:feature -- --feature-surface=…` --> |

- [ ] L0: `pnpm check` green (includes `eval:test`)
- [ ] L1 (optional): `pnpm eval:l1`
- [ ] L2 (opt-in): `eval:feature` or CI label `eval:run`

## Test plan

- [ ]
