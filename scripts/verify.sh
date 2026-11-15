#!/usr/bin/env bash
#
# Repository verification entry point (run by the dev pipeline after every task and
# at integration). Every component must add its build + test commands here.
#
# Rules:
#   - non-interactive, deterministic, exits non-zero on any failure
#   - skip components that do not exist yet (the tree is built up incrementally)
#   - Windows Git Bash compatible
#
# Usage (from anywhere): bash scripts/verify.sh

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

ran=0

# --- components -------------------------------------------------------------
# Add one block per component, e.g.:
#
# if [ -f server/package.json ]; then
#   echo "verify: server"
#   (cd server && npm ci && npm test && npm run build)
#   ran=$((ran + 1))
# fi
# ---------------------------------------------------------------------------

if [ -f package.json ]; then
  echo "verify: node workspaces"
  npm ci
  # Design-rule checker: its unit tests, then the whole-repo lint.
  node --test scripts/check-rules.test.mjs
  npm run lint
  npm run typecheck
  npm test
  npm run build
  ran=$((ran + 1))
fi

if [ "$ran" -eq 0 ]; then
  echo "verify: no components yet (skipped)"
fi
echo "verify: ok"
