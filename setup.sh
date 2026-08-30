#!/usr/bin/env bash
# ------------------------------------------------------------------
# Ahmadiwebsite — one-shot setup: Git init, verify, repo, push, Pages
# Run this from the project root after the shell environment works:
#   bash setup.sh
# Requires: git, gh (authenticated as alirezaiwisi1)
# ------------------------------------------------------------------
set -euo pipefail

REPO="alirezaiwisi1/Ahmadiwebsite"
cd "$(dirname "$0")"

echo "==> 1/7 Safety: sources/ must be ignored"
grep -qx "sources/" .gitignore || { echo "ERROR: sources/ not in .gitignore"; exit 1; }

if [ ! -d .git ]; then
  git init
  git branch -M main
fi

echo "==> 2/7 Verify PDF is NOT tracked"
git add -A
if git ls-files | grep -q "^sources/"; then
  echo "ERROR: sources/ is tracked! Aborting."
  git rm -r --cached sources/ >/dev/null 2>&1 || true
  exit 1
fi
echo "OK: sources/ not tracked. Files to commit:"
git status --short

echo "==> 3/7 Commit"
if [ -z "$(git status --porcelain --untracked-files=no)" ] && [ "$(git rev-parse --verify HEAD 2>/dev/null || echo none)" != "none" ]; then
  echo "Nothing to commit."
else
  git commit -m "Initial release: Persian RTL website for Ahmadi Religion of Peace and Light"
fi

echo "==> 4/7 Create repo if missing (never touches apple-id-store)"
if gh repo view "$REPO" >/dev/null 2>&1; then
  echo "Repo exists."
else
  gh repo create "$REPO" --public --source=. --remote=origin --push=false
fi
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/$REPO.git"

echo "==> 5/7 Push"
git push -u origin main

echo "==> 6/7 Enable GitHub Pages (Actions source)"
gh api -X POST "repos/$REPO/pages" \
  -f build_type=workflow \
  -f source='{"branch":"main","path":"/"}' >/dev/null 2>&1 || \
  gh api -X POST "repos/$REPO/pages" -f build_type=workflow || true

echo "==> 7/7 Status"
gh repo view "$REPO" --web=false || true
echo "Watch deployment: gh run watch --repo $REPO"
echo "Expected URL: https://alirezaiwisi1.github.io/Ahmadiwebsite/"
