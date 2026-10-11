# Compatibility and verification

## Download channels (checked 2026-10-11)

The npm registry reported `latest` and `next` as **0.2.0-rc.2**, and `alpha` as
**0.2.1-alpha.2**. The newest GitHub release is `dsh-v0.2.1-alpha.2`, published
2026-10-09. A GitHub prerelease is not necessarily npm's default download.

DSH Web is launched by the `@deepseek-ai/dsh` CLI (`dsh web`); the package
`@deepseek-ai/dsh-web` is not a replacement CLI installer.

| Plugin | Host release | Intent |
| --- | --- | --- |
| 0.0.2 | 0.2.0-rc.2 | Default npm download at this checkpoint |
| 0.0.2 | 0.2.1-alpha.1 | Existing preview installations |
| 0.0.2 | 0.2.1-alpha.2 | Latest published alpha; development/typecheck baseline |

Only these exact prereleases are admitted by `engines.dsh` and the DSH peer
family. Other versions require a new compatibility run, not an unrestricted
`>=` range. The rc.2 host uses Cordis 4.0.4 and Schemastery 3.18.4; alpha hosts
use Cordis 4.0.5-alpha.1 and Schemastery 3.18.5-alpha.1. Both vendor pairs are
admitted explicitly, while the build uses the alpha pair. React stays supplied
by the Web shell, not bundled.

## Runtime requirements

Node 24+, Linux or macOS, and a local running Herdr server. Herdr control-plane
fixtures use **0.9.0 / protocol 22**. Windows named-pipe support and arbitrary
Herdr protocol upgrades are not claimed. For WSL, both the server and plugin
must run inside the same Linux environment.

## Gates

The `ci` workflow runs a frozen dependency install, build, strict typecheck,
generated-type check and complete unit suite. Packaging tests extract the actual
`pnpm pack` tarball and verify exports, types, locale files and Web factory
externals. The DSH smoke matrix installs that tarball with each published CLI in
a disposable `DSH_HOME`, opens the real Web shell in Chromium, visits the Herdr
dashboard, checks unhandled browser errors, then uninstalls the plugin.

Real Herdr integration uses the pinned 0.9.0 Linux binary with its SHA-256 checked,
a unique test session, and mandatory preflight. Missing prerequisites fail CI;
local integration may still explicitly skip when Herdr is unavailable.

A passing check certifies only the scenarios it executes. It does not certify
LLM-driven agent work, credentials, remote multi-user isolation, every terminal
reconnect race or every supported operating system. The larger review-hardening
work remains separate in draft PR #13 and is not included in this release.

For release acceptance, inspect checks on the exact PR head/merge commit and
its `dsh-smoke-*` evidence artifacts. Do not treat an old green run or a skipped
integration job as evidence for a new commit.

## Sources

- https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.2
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.2/README.md
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/vendor/cordis/package.json
- https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/vendor/schemastery/package.json
- https://registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags

Registry evidence is collected by CI with `npm view @deepseek-ai/dsh dist-tags --json`.
