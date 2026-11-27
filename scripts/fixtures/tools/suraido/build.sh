#!/bin/sh
# Rebuilds dist/ from src/ with the versions locked in package-lock.json.
# Never edit dist/ by hand. The build runs in a temporary copy, so that
# node_modules never lands in the repository.
set -eu
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R index.html package.json package-lock.json tsconfig.json vite.config.ts src "$work"
(cd "$work" && npm ci --no-audit --no-fund < /dev/null && npm run build < /dev/null)
rm -rf dist
cp -R "$work/dist" dist
