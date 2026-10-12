#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
URL='https://github.com/gristeixeira/vtt-capture.git'
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git init -b main
fi
if ! git config user.name >/dev/null; then
  echo 'Configura git config user.name antes de publicar.' >&2
  exit 1
fi
if ! git config user.email >/dev/null; then
  echo 'Configura git config user.email antes de publicar.' >&2
  exit 1
fi
git add -A
if ! git diff --cached --quiet; then
  git commit -m 'feat: initial FHAD VTT Capture v0.8.2 source (development)'
fi
if ! git remote get-url origin >/dev/null 2>&1; then
  git remote add origin "$URL"
elif [ "$(git remote get-url origin)" != "$URL" ]; then
  echo 'Remote origin inesperado; por segurança, não vou alterar.' >&2
  exit 1
fi
echo "A publicar em $URL ..."
git push -u origin HEAD:main
