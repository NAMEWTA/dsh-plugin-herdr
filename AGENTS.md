# Repository Guidelines

Contributor guide for **@namewta/dsh-plugin-herdr** 0.0.3, the Herdr control-plane plugin for DeepSeek Harness. It provides 19 `herdr_*` tools, a Web dashboard and a runtime-registered Herdr session preset. This release workflow distributes GitHub tarballs; npm publication is a separate operation and older registry versions must not be confused with a new tarball.

## Compatibility

Node 24+; pnpm 10.28.2. Supported DSH releases are the finite set **0.2.0-rc.2, 0.2.1-alpha.1 and 0.2.1-alpha.2**. Development dependencies use exact alpha.2 pins; peer dependencies and `engines.dsh` list the supported releases explicitly. Herdr fixtures target **0.9.0 / protocol 22**. Read `COMPATIBILITY.md` before changing version claims. GitHub's newest prerelease and npm's default download can differ.

## Structure

- `src/core/`: framework-independent protocol, errors, output, polling, ANSI and path utilities. `protocol.ts` is generated from the schema fixture.
- `src/host/`: `index.ts` mounts provider then runtime; `herdr/` contains the socket service, `tools/registry.ts` is the authoritative list of tools, `events/` handles subscriptions and reporting, `panel/` exposes Typert Remote, and `terminal-session/` manages CLI processes. `session-mode.ts` is a separate preset child entry.
- `src/web/`: client views, stores and pure UI logic; `src/client.tsx` is the thin entry. React is supplied by the host shell. Preserve the `ModuleLoader` factory contract and synchronous style injection required by `claimStyles`.
- `locale/{zh,en}.json`: shared bilingual panel/brand dictionaries.
- `scripts/`: protocol/Typert generation, package verification, isolated DSH smoke.
- `test/unit/`: Node tests, including built-client activation and bilingual SSR. `test/packaging/`: tarball validation regressions. `test/integration/`: real Herdr tests. `test/fixtures/`: protocol schema and recorded Remote payloads.
- `lib/`: generated and gitignored. `cordis.patch.yml`: one runtime plugin insert.

The historical YAML under `presets/herdr/` is not the active preset definition: `src/host/preset.ts` registers the runtime preset. Do not change one and assume the other changed. The unfinished broader architecture hardening is isolated in draft PR #13, not part of this compatibility release.

## Commands and acceptance

```sh
pnpm install --frozen-lockfile
pnpm quality
pnpm pack
pnpm check:package ./namewta-dsh-plugin-herdr-0.0.3.tgz
pnpm test:integration
```

`quality` builds Host/Typert/Web, typechecks, checks generated protocol drift, and runs unit and packaging tests. `prepack` builds automatically; `prepublishOnly` runs quality. Never claim an unbuilt Git checkout is an installable package.

The required CI jobs run on Node 24. The DSH matrix downloads each published CLI and installs, opens the actual Chromium Web dashboard, then removes the same tarball in a disposable `DSH_HOME`. Real Herdr integration uses a pinned, checksum-verified binary and an isolated named session. `HERDR_REQUIRE_INTEGRATION=1` makes missing prerequisites fail rather than skip. Local integration can skip explicitly, but a skip is not acceptance evidence.

Keep tests for the production path, not only source-string sentinels. New behavior requires a failing regression before the fix. Do not weaken assertions to hide failures. Record exactly which checks ran and which still require credentials or manual testing.

## TypeScript and ownership

Strict TypeScript, NodeNext/ES2022, automatic JSX. Two spaces, no semicolons, single quotes; camelCase values, PascalCase types, kebab-case files. Keep comments concise. No general-purpose linter is configured; strict typecheck and contract tests are the enforced baseline.

Declare injected Cordis services on the owning fiber. Tie timers, subscriptions and child processes to explicit lifetimes. Avoid side effects after cancellation and never infer whole-workspace ownership from a pane token. Do not modify a user's live DSH/Herdr profile during tests.

## Localization

Every new visible string needs both zh and en, including matching placeholders. Use `t()`/`useHerdrLang()` and the runtime locale service; static `html lang` is not the active language. `brand.*` supplies hero/preset copy. Preserve locale-parity and real render regressions.

## Changes and PRs

Use Conventional Commits. PR titles/descriptions and issues are English by default. Keep compatibility changes separate from broad refactors. Do not merge until required checks pass on the exact head and disclose any remaining validation limits. Never claim tests were run based only on an old report. Do not publish to npm or alter branch-protection settings without explicit authorization.
