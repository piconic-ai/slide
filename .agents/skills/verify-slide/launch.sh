#!/bin/sh
# Starts a local Worker for verification on its own port and state directory,
# so that several checkouts can run side by side. Stays in the foreground;
# stop it by killing this process.
#
#   .agents/skills/verify-slide/launch.sh <port> <state directory>
set -eu
port=${1:?Name a port, such as 8811}
state=${2:?Name a directory for the local D1 and R2}
origin="http://localhost:$port"
pnpm exec wrangler d1 migrations apply slide --local --persist-to "$state"
exec pnpm exec wrangler dev --local --port "$port" --persist-to "$state" \
  --infer-origin-from-routes=false \
  --var "PUBLIC_ORIGIN:$origin" \
  --var "CONTENT_ORIGIN:$origin" \
  --var BETTER_AUTH_SECRET:local-demo-only-better-auth-secret-000000 \
  --var MAIL_OUTBOX:on \
  --var PICTURE_LOCAL:on
