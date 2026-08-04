# Truncated tool output — recovery strategies

When Composer truncates a tool result during compile, Ocula injects `[strategies]` into the tool result footnote and may add a synthetic user reminder before the next LLM turn.

## Decision flow

```
truncated?
  ├─ bash + diff --git → git_diff stat=true → git_diff path=<scope>
  ├─ git_diff full     → stat=true or path=<file>
  ├─ read_file         → offset/limit or grep path=<file>
  ├─ grep              → narrower path/glob/max_results
  └─ any + artifact id → read_artifact once (never repeat same bash)
```

## Anti-patterns (from real sessions)

| Bad | Better |
|-----|--------|
| Multiple `bash git diff crates/...` batches | `git_diff stat=true` then one `path=` per crate |
| Re-run same bash after `[truncated]` | Follow `[strategies]` block |
| `read_artifact` then bash again for same content | Work from artifact or scoped git_diff |

Implementation: `crates/ocula-tools/src/truncation_strategies.rs`
