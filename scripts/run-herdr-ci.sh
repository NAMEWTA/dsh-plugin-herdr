#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?This helper requires a disposable GitHub runner}"
: "${GITHUB_RUN_ID:?Missing run identity}"
if [ "$#" -eq 0 ]; then echo 'Pass the test command to run' >&2; exit 2; fi
export HERDR_SESSION="dsh-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT:-1}"
herdr server >"$RUNNER_TEMP/herdr-server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true' EXIT
ready=0
for i in $(seq 1 60); do
  if herdr status server --json | grep -q '"running": *true'; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
"$@"
