#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?Use a disposable runner}"
: "${GITHUB_PATH:?Missing runner PATH file}"
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo 'Only the checksum-pinned Linux x86_64 acceptance target is supported.' >&2
  exit 2
fi
mkdir -p "$RUNNER_TEMP/herdr-bin"
curl --fail --location --retry 3 https://github.com/herdrdev/herdr/releases/download/v0.9.3/herdr-linux-x86_64 -o "$RUNNER_TEMP/herdr-bin/herdr"
echo "18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7  $RUNNER_TEMP/herdr-bin/herdr" | sha256sum --check
chmod +x "$RUNNER_TEMP/herdr-bin/herdr"
echo "$RUNNER_TEMP/herdr-bin" >> "$GITHUB_PATH"
