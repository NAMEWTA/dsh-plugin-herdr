#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?This installer requires a disposable GitHub runner}"
: "${GITHUB_PATH:?Missing runner PATH file}"
bin_dir="$RUNNER_TEMP/herdr-bin"
mkdir -p "$bin_dir"
curl --fail --location --retry 3 https://github.com/herdrdev/herdr/releases/download/v0.9.0/herdr-linux-x86_64 -o "$bin_dir/herdr"
echo "4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f  $bin_dir/herdr" | sha256sum --check
chmod +x "$bin_dir/herdr"
echo "$bin_dir" >> "$GITHUB_PATH"
