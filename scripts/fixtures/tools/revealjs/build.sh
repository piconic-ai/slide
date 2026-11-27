#!/bin/sh
# Rebuilds dist/ (the defaults, with a theme) and dist-<name>/ (one per
# variant in src/<name>.html) from the sources and the reveal.js locked in
# package-lock.json. Never edit a dist by hand. The install runs in a
# temporary copy, so that node_modules never lands in the repository.
set -eu
cd "$(dirname "$0")"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp package.json package-lock.json "$work"
(cd "$work" && npm ci --no-audit --no-fund < /dev/null)
lib="$work/node_modules/reveal.js/dist"
rm -rf dist dist-*

mkdir -p dist/dist/theme
cp src/index.html dist/index.html
for file in reset.css reveal.css reveal.js; do
  cp "$lib/$file" "dist/dist/$file"
done
cp "$lib/theme/black.css" dist/dist/theme/black.css

# The variants differ in how the page initializes reveal.js, not in the
# theme, so they leave it out.
for source in src/*.html; do
  name=$(basename "$source" .html)
  [ "$name" = index ] && continue
  mkdir -p "dist-$name/dist"
  cp "$source" "dist-$name/index.html"
  for file in reset.css reveal.css reveal.js; do
    cp "$lib/$file" "dist-$name/dist/$file"
  done
done
