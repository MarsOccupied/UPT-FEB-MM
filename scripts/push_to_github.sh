#!/usr/bin/env bash
# Push local repository to GitHub. Do NOT hard-code tokens here.
# Options:
# 1) Using gh (recommended):
#    gh auth login  # if not already logged in
#    gh repo create <owner>/<repo> --public --source=. --remote=origin --push
# 2) Using HTTPS + token in environment (less recommended):
#    GITHUB_TOKEN="<YOUR_TOKEN>" ./scripts/push_to_github.sh your-github-username repo-name
# This script will add remote and push.

set -euo pipefail
if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <github-username> <repo-name>"
  echo "Examples:"
  echo "  gh repo create myuser/mindmap-tool --public --source=. --remote=origin --push"
  exit 1
fi

USER="$1"
REPO="$2"

# prefer gh if available
if command -v gh >/dev/null 2>&1; then
  echo "Using gh to create repo (if needed) and push..."
  gh repo create "${USER}/${REPO}" --public --source=. --remote=origin --push || true
  git push -u origin HEAD
  exit 0
fi

# fallback: use HTTPS remote (requires GITHUB_TOKEN env var)
if [ -z "${GITHUB_TOKEN-}" ]; then
  echo "GITHUB_TOKEN not set. Set it or install the GitHub CLI (gh)." >&2
  exit 1
fi

REMOTE_URL="https://${GITHUB_TOKEN}@github.com/${USER}/${REPO}.git"

# create remote repo via API
curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
  -d "{\"name\": \"${REPO}\", \"private\": false}" https://api.github.com/user/repos || true

git remote add origin "${REMOTE_URL}" || git remote set-url origin "${REMOTE_URL}"
git push -u origin HEAD

echo "Pushed to https://github.com/${USER}/${REPO} (use gh or GITHUB_TOKEN locally)."