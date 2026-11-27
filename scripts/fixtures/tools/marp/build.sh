#!/bin/sh
# Rebuilds dist/index.html from deck.md with the pinned marp-cli.
# Never edit dist/ by hand.
set -eu
MARP_CLI_VERSION=4.5.1
cd "$(dirname "$0")"
rm -rf dist
npx --yes "@marp-team/marp-cli@$MARP_CLI_VERSION" deck.md --html --output dist/index.html
