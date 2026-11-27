#!/bin/sh
# Rebuilds dist/ from deck.md with the pinned peitho. Never edit dist/ by hand.
set -eu
PEITHO_VERSION=1.48.1
cd "$(dirname "$0")"
actual=$(peitho --version)
if [ "$actual" != "peitho $PEITHO_VERSION" ]; then
  echo "Expected peitho $PEITHO_VERSION, found: $actual" >&2
  exit 1
fi
rm -rf dist
peitho build deck.md
