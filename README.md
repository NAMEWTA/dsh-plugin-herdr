# @namewta/dsh-plugin-herdr

> **English** | [简体中文](README.zh-CN.md)

![Herdr panel](assets/home.png)

Herdr control-plane plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
19 `herdr_*` tools, a Web dashboard, and a Herdr session preset with a dedicated workspace.

## Requirements and supported downloads

Plugin **0.0.2** targets Node **24+** and DSH **0.2.0-rc.2**, **0.2.1-alpha.1**, or
**0.2.1-alpha.2**. DSH's plugin installer also requires **pnpm on PATH**. Run the
plugin and Herdr on the same Linux/macOS host (Herdr 0.9.0 / protocol 22 baseline).
Windows named pipes are not supported.

As checked on **2026-10-11**, npm `latest`/`next` resolve to **0.2.0-rc.2**, while
`alpha` resolves to **0.2.1-alpha.2**. Thus `npx @deepseek-ai/dsh web` does not
necessarily run the newest GitHub prerelease. See [compatibility](COMPATIBILITY.md).

```sh
npm install --global pnpm@10.28.2
# Current default-download release, pinned for reproducibility
npm install --global @deepseek-ai/dsh@0.2.0-rc.2
# Or explicitly opt in to the latest alpha instead:
# npm install --global @deepseek-ai/dsh@0.2.1-alpha.2
dsh --version
pnpm --version
```

## Install the prebuilt plugin

Download `namewta-dsh-plugin-herdr-0.0.2.tgz` and `SHA256SUMS` from
[GitHub Releases](https://github.com/NAMEWTA/dsh-plugin-herdr/releases). A release
is created only after main's full CI, real Herdr tests and DSH Web installation
matrix pass. The same package is also available in a successful `ci` run's
`herdr-plugin-package` artifact. This plugin is not separately published to npm.

```sh
# Run in the directory containing the downloaded package and checksum file
sha256sum --check SHA256SUMS  # macOS: shasum -a 256 --check SHA256SUMS
dsh plugin --profile web add /absolute/path/namewta-dsh-plugin-herdr-0.0.2.tgz
dsh plugin --profile web list
dsh web
```

Restart an already running Web profile after installing or replacing the package.
The same prebuilt tarball can be selected in DSH's plugin installation UI.
Open the **Herdr** sidebar entry to view the dashboard. Select **Herdr mode** for
a conversation's dedicated workspace. Herdr itself must be installed and running;
the panel can start its binary from `PATH` when available.

Do not install an unbuilt Git checkout directly: it contains no `lib/` artifacts.
A GitHub source archive is not the prebuilt plugin tarball.

## Build from source

```sh
git clone https://github.com/NAMEWTA/dsh-plugin-herdr.git
cd dsh-plugin-herdr
npm install --global pnpm@10.28.2
pnpm install --frozen-lockfile
pnpm quality
pnpm pack  # prepack automatically builds Host + Typert + Web
pnpm check:package ./namewta-dsh-plugin-herdr-0.0.2.tgz
dsh plugin --profile web add ./namewta-dsh-plugin-herdr-0.0.2.tgz
```

## Upgrade and uninstall

Install the new tarball into the same `web` profile and restart it. A failed
compatibility check should be resolved by matching a supported DSH release,
not by forcing peer installation or copying another version's `node_modules`.

```sh
dsh plugin --profile web remove @namewta/dsh-plugin-herdr
```

Restart the profile to unload the tools, panel and runtime-registered preset.
Only older manually copied presets may leave files in `.agent-presets/herdr/`;
the current plugin does not install a preset directory there.

## Development

`pnpm quality` runs build, typecheck, protocol drift checks, unit and packaging
regression tests. `pnpm test:integration` needs a live Herdr server and may skip
locally when unavailable; CI requires it to run. Actual DSH Web installation and
browser smoke are separate CI matrix checks.

The unresolved broad hardening work is tracked in draft PR #13; this bounded
compatibility release does not claim to complete it.

## License

MIT © 2026 NAMEWTA. Includes code originally written by sunny0826; see [LICENSE](LICENSE).
