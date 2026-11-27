#!/bin/sh
# Rebuilds dist/ from slides.md with the pinned Slidev and theme.
# Never edit dist/ by hand.
set -eu
SLIDEV_CLI_VERSION=53.2.0
SLIDEV_THEME_VERSION=0.25.0
cd "$(dirname "$0")"
rm -rf dist
npx --yes -p "@slidev/cli@$SLIDEV_CLI_VERSION" \
  -p "@slidev/theme-default@$SLIDEV_THEME_VERSION" \
  slidev build slides.md --out dist < /dev/null
# Slidev's build cache; not part of the output.
rm -rf node_modules
