#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?This installer requires a disposable GitHub runner}"
: "${GITHUB_PATH:?Missing runner PATH file}"
version="${HERDR_CI_VERSION:-0.9.0}"
case "$version" in
  0.9.0) checksum=4fa1a01158dd8043da92d31b270780b0dcc10603038d9b61cac4d81ab63fb71f ;;
  0.9.3) checksum=18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7 ;;
  *) echo "Unverified Herdr CI version: $version" >&2; exit 2 ;;
esac
if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo 'This checksum-pinned CI installer supports Linux x86_64 only' >&2
  exit 2
fi
bin_dir="$RUNNER_TEMP/herdr-bin"
mkdir -p "$bin_dir"
curl --fail --location --retry 3 "https://github.com/herdrdev/herdr/releases/download/v$version/herdr-linux-x86_64" -o "$bin_dir/herdr"
echo "$checksum  $bin_dir/herdr" | sha256sum --check
chmod +x "$bin_dir/herdr"
echo "$bin_dir" >> "$GITHUB_PATH"
