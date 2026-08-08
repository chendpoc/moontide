#!/usr/bin/env bash
set -euo pipefail

LOG_N={{log_n}}

echo "=== git status ==="
git status -sb || true
echo ""
echo "=== recent log (last ${LOG_N}) ==="
git log --oneline -n "${LOG_N}" 2>/dev/null || echo "(not a git repo or no commits)"
echo ""
echo "=== diff stat ==="
git diff --stat 2>/dev/null || echo "(no diff)"
