#!/usr/bin/env bash
# Fail if local main is not identical to origin/main (for the tracked tree).
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch origin --prune
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [[ "$LOCAL" != "$REMOTE" ]]; then
  echo "OUT OF SYNC: local=$LOCAL remote=$REMOTE"
  git status -sb
  git log --oneline --left-right "${REMOTE}...${LOCAL}" | head -20
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "DIRTY WORKTREE — commit or stash before claiming sync:"
  git status --porcelain
  exit 1
fi

echo "IN SYNC with origin/main @ $LOCAL"
git ls-files | wc -l | awk '{print $1 " tracked files"}'
