#!/bin/sh
# Rebuilds dist/ from src/index.html and the reveal.js locked in
# package-lock.json. Never edit dist/ by hand. The install runs in a
# temporary copy, so that node_modules never lands in the repository.
set -eu
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp package.json package-lock.json "$work"
(cd "$work" && npm ci --no-audit --no-fund < /dev/null)
rm -rf dist
mkdir -p dist/dist/theme
cp src/index.html dist/index.html
for file in reset.css reveal.css reveal.js; do
  cp "$work/node_modules/reveal.js/dist/$file" "dist/dist/$file"
done
cp "$work/node_modules/reveal.js/dist/theme/black.css" dist/dist/theme/black.css
