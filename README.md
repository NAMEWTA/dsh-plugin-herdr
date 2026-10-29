<div align="center">

<img src="assets/workbench.svg" width="64" height="64" alt="">

# DSH Workbench for Herdr

**Watch and safely drive your Herdr workspaces, terminals and AI coding agents from DeepSeek Harness (DSH) Web.**<br>
Read-only by default. Taking control is always a separate, confirmed step.

[![CI](https://github.com/NAMEWTA/dsh-plugin-herdr/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/NAMEWTA/dsh-plugin-herdr/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/NAMEWTA/dsh-plugin-herdr?include_prereleases&sort=semver&label=release&color=111)](https://github.com/NAMEWTA/dsh-plugin-herdr/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-111)](LICENSE)
[![DSH 0.2.1-rc.2](https://img.shields.io/badge/DSH-0.2.1--rc.2-111)](#compatibility)
[![Herdr 0.9.3](https://img.shields.io/badge/Herdr-0.9.3%20%C2%B7%20protocol%2022-111)](#compatibility)
[![Node 24](https://img.shields.io/badge/node-%E2%89%A524.22.0%20%3C25-111)](#compatibility)

**English** · [简体中文](README.zh-CN.md)

<img src="docs/assets/demos/g1-hero.gif" width="960" alt="Opening Workbench from the DSH sidebar, scanning the overview and opening a live Herdr terminal in read-only observe mode">

</div>

> **Status: alpha preview (`1.0.4-alpha.1`).** Distributed as a GitHub prerelease tarball, not on npm. Verified on Linux x86_64 with DSH 0.2.1-rc.2 and Herdr 0.9.3. See [release notes](docs/releases/1.0.4-alpha.1.md).

## Contents

[Why](#why) · [Features](#features) · [Quick start](#quick-start) · [Usage](#usage) · [Configuration](#configuration) · [Security model](#security-model) · [Compatibility](#compatibility) · [Troubleshooting](#troubleshooting) · [Upgrading](#upgrading) · [Development](#development) · [Contributing](#contributing) · [License & credits](#license--credits)

## Why

[Herdr](https://github.com/herdrdev/herdr) is a terminal workspace manager for AI coding agents: it keeps many shells and agents (Claude Code, Codex, …) running in workspaces, tabs and panes. [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) is where you already chat with a model in the browser. Without a bridge you keep switching between the two and cannot see what your agents are doing from DSH.

DSH Workbench for Herdr puts Herdr inside DSH Web: one overview of every workspace, live terminals you can watch without risk, and control only when you explicitly ask for it. A DSH session can also be bound to a single Herdr workspace, so the model can look at it and, with your approval, act on it.

## Features

### Overview of every workspace and pane

Workspaces, tabs, panes and agent states (`working`, `blocked`, `idle`, `done`, `unknown`) from the Herdr socket in one place, with an attention inbox for anything that needs input. Updates arrive through Herdr's event stream and fall back to polling if the stream is unavailable.

<img src="docs/assets/screenshots/overview-light.png" width="860" alt="Workbench overview listing the acme-api, docs-site and web-app workspaces with their panes">

### Observe first, control on request

Opening a pane attaches a browser terminal (xterm) in **observe** mode, so input is disabled. **Acquire control** asks for confirmation first. For a pane created outside Workbench it also adopts only that pane. **Observe** drops back to read-only. Control leases are exclusive within Workbench, and unconfirmed keystrokes are never replayed after a disconnect.

<img src="docs/assets/demos/g2-observe-control.gif" width="860" alt="Acquiring control of a pane, confirming, typing git status in the real terminal, then returning to observe mode">

### A Herdr tab in every DSH session

The right sidebar of a DSH session gets a **Herdr** tab. When the session has a project path and nothing is bound yet, that path becomes this session's workspace automatically. No model or tool call is needed. The empty state stays only when the project path cannot be resolved. The tab then shows the session tree (workspace › tab › terminal) and opens terminals inline.

<img src="docs/assets/demos/g3-session-rail.gif" width="860" alt="Creating and binding a Herdr workspace from the DSH session sidebar, then observing its terminal">

Binding also scopes the model tools: `workbench_herdr_inspect` (read-only, and it binds the project path on the first call), `workbench_herdr_launch` (start Codex or Claude Code without sending them anything, behind a DSH approval prompt), and `workbench_herdr_action` (a short allow-list of changes inside the bound workspace, also behind approval). See [Let the model help](#let-the-model-help).

### Command palette

Press <kbd>Ctrl</kbd>/<kbd>⌘</kbd> <kbd>K</kbd> or click **Command palette** to jump to Overview, Attention, Workspaces, Agents, Terminals, Pane inspector, Environment, or create a workspace.

<img src="docs/assets/demos/g4-command-palette.gif" width="860" alt="Using the command palette to jump to Terminals, Environment and back to Overview">

### Environment and diagnostics

**Environment and connection** shows the DSH host platform, the Herdr CLI path and version, the approved workspace root, the running service (version, protocol, socket, session), the host Node process (CPU, RSS) and the terminal budget. Checking never installs software or starts a service unless you press **Start service**.

<img src="docs/assets/demos/g5-environment.gif" width="860" alt="Environment page: re-check, Herdr 0.9.3 and protocol 22, resource budget and verified baseline">

### Language, theme, density, small screens

English or 简体中文, light, dark or system theme, comfortable or compact density, and a drawer layout on narrow screens. These settings apply to Workbench only, not the DSH host.

<img src="docs/assets/demos/g6-appearance.gif" width="860" alt="Switching Workbench to Simplified Chinese and compact density, then following the system dark appearance">

| Dark, 简体中文 | Narrow screen |
|---|---|
| <img src="docs/assets/screenshots/overview-dark-zh.png" width="420" alt="Overview in dark theme and Simplified Chinese"> | <img src="docs/assets/screenshots/narrow.png" width="420" alt="Workbench at 390 px wide, overview and navigation drawer"> |

<details>
<summary>More screenshots</summary>

| Terminal, observe mode | Acquire control confirmation |
|---|---|
| <img src="docs/assets/screenshots/terminal-observe.png" width="420" alt="Terminal page in observe mode with live git log output"> | <img src="docs/assets/screenshots/terminal-control.png" width="420" alt="Acquire terminal control confirmation dialog"> |
| **Session sidebar** | **Command palette** |
| <img src="docs/assets/screenshots/session-rail.png" width="420" alt="DSH session with the Herdr tab bound to web-app"> | <img src="docs/assets/screenshots/command-palette.png" width="420" alt="Command palette filtered by term"> |
| **Environment and connection** | |
| <img src="docs/assets/screenshots/environment.png" width="420" alt="Environment page with Herdr 0.9.3, protocol 22 and socket path"> | |

</details>

## Quick start

### Prerequisites

| | Version | Notes |
|---|---|---|
| OS | Linux x86_64 | The CI-verified target. macOS, native Windows and WSL are not verified. DSH and Herdr must run on the same machine. The browser can be elsewhere. |
| Node.js | 24.22.0 or newer, below 25 | Required by DSH and this package (`engines`). |
| DeepSeek Harness | 0.2.1-rc.2 | `npm install --global @deepseek-ai/dsh@0.2.1-rc.2` |
| Herdr | 0.9.3 (protocol 22) | See step 1. Other protocol versions are read-only at best. Writes are refused. |

### 1. Install Herdr 0.9.3

```sh
mkdir -p ~/.local/bin
curl -fL https://github.com/herdrdev/herdr/releases/download/v0.9.3/herdr-linux-x86_64 -o ~/.local/bin/herdr
echo "18a8dc65f1c2fa485884344356dea1cfd911c6f06cf46fa78e193f4087f4dba7  $HOME/.local/bin/herdr" | sha256sum --check
chmod +x ~/.local/bin/herdr
```

### 2. Download and verify the plugin

```sh
V=1.0.4-alpha.1
BASE=https://github.com/NAMEWTA/dsh-plugin-herdr/releases/download/v$V
for f in namewta-dsh-workbench-$V.tgz build.json SHA256SUMS; do curl -fLO "$BASE/$f"; done
sha256sum --check --ignore-missing SHA256SUMS
```

`build.json` records the source commit and the pinned `dsh`, `herdr` and protocol versions of the build.

### 3. Add it to the DSH web profile

```sh
dsh plugin --profile web add "$PWD/namewta-dsh-workbench-$V.tgz"
```

Install the built `.tgz`. A source checkout cannot be added directly. Peer-dependency warnings about `@deepseek-ai/*` packages are expected, because DSH provides them at runtime.

### 4. Start Herdr and DSH Web

```sh
herdr            # opens the Herdr TUI and its persistent server (or: herdr server)
dsh web          # in another terminal; prints a local URL with a one-time token
```

Open the printed URL. On first launch, DSH shows **Preview Notice** (click **Continue**) and then **Get started**, which asks for a DeepSeek login or API key. **Press <kbd>Esc</kbd> to close Get started.** Workbench does not need a model. Click **Workbench** in the DSH sidebar.

> If Herdr is not running yet, open **Environment and connection** and press **Start service**. If Herdr uses a non-default socket, set `socket` (see [Configuration](#configuration)).

## Usage

### Watch and take control

1. In **Overview** or **Terminals**, click a pane (for example `w1:p1`). The terminal opens as **Observing · Input disabled**.
2. Click **Acquire control** and confirm. For a pane that Workbench did not create, the dialog states that only this pane will be adopted and that nothing is typed automatically.
3. Type in the terminal. The status reads **Controlling · Live terminal input**.
4. Click **Observe** to return to read-only, or **Stop observing / release control** to detach. Closing the view releases the bridge only. The shell or agent keeps running in Herdr.

**Take over control** is a separate action for taking a lease that another Workbench window holds. Paste goes through **Safe paste**, which asks for confirmation.

### Manage resources

From Workbench you can create a workspace (under the approved root), rename, split a pane, open a tab, start an approved agent (`claude`, `codex` by default), close resources, and explicitly adopt resources created outside Workbench. Destructive actions ask for confirmation. Workbench never closes external agents when you close a page or disable the plugin.

### Bind a DSH session

Open a session whose directory is the project path. The Herdr tab binds that directory for this session. Workbench never falls back to "the focused workspace", and a stale binding fails closed after Herdr restarts. A session with no project path stays unbound until you bind one manually.

### Let the model help

With `toolsEnabled` on (default), the model gets three tools:

| Tool | What it can do |
|---|---|
| `workbench_herdr_inspect` | Read this session's workspace. The first call binds the session project path when nothing is bound. `INVALID_REQUEST` when the session has no project path. |
| `workbench_herdr_launch` | Start Codex and Claude Code in that workspace and do not send them a prompt. `{"agents":[{"kind":"codex","count":4},{"kind":"claude","count":4}],"send":false}`. One call starts up to 8. Every call shows a DSH approval prompt first. |
| `workbench_herdr_action` | Rename, close, split, or open a tab **inside the bound workspace**. Every call shows a DSH approval prompt first. It does not start agents. No raw keystrokes, no implicit adoption, no cross-workspace actions. |

The agent preset **Workbench · Herdr** primes the model to use these tools this way. Using the model requires DSH to be signed in or configured with an API key.

## Configuration

Workbench is added to the profile as the entry `namewta-workbench`. Override its settings in your profile's patch layer, `~/.dsh/profiles/web/cordis.patch.yml` (or `$DSH_HOME/profiles/web/…`), then restart `dsh web`:

```yaml
- id: namewta-workbench
  config:
    socket: /home/me/.config/herdr/herdr.sock
    readOnly: false
    maxObservers: 8
```

Run `dsh web --dump-config` to check the composed result. All paths must be absolute.

| Key | Default | Description |
|---|---|---|
| `socket` | `~/.config/herdr/herdr.sock` | Herdr API socket. For a non-default session, the sessions sub-directory is used. Set it explicitly when you use custom XDG paths. |
| `session` | `default` | Herdr session name (letters, digits, `_`, `-`, 1–64 chars). |
| `binary` | auto | Path to `herdr`. Falls back to `WORKBENCH_HERDR_BINARY`, then a controlled PATH lookup. A wrong explicit path is never silently replaced. |
| `workspaceRoot` | DSH working directory | New workspaces must resolve (realpath) inside this root. |
| `dataDirectory` | `<profile>/workbench/` | Workbench state (bindings, ledger, audit). |
| `readOnly` | `false` | Grant only read and observe. No control and no resource changes. |
| `pollMs` | `3000` | Poll interval when the event stream is unavailable (500–30000). |
| `toolsEnabled` | `true` | Register the three model tools. |
| `maxObservers` | `8` | Concurrent observe sessions (0–64). |
| `maxControllers` | `2` | Concurrent control sessions (0–16). |
| `maxProcesses` | `16` | Terminal bridge processes, including ones still closing (1–128). |

Environment variables: `WORKBENCH_HERDR_SOCKET` (socket) and `WORKBENCH_HERDR_BINARY` (binary), for example:

```sh
WORKBENCH_HERDR_SOCKET=/abs/path/herdr.sock WORKBENCH_HERDR_BINARY=/abs/path/herdr dsh web
```

## Security model

Taking control of a terminal means running programs as the user who runs Herdr. Workbench is a control plane, not a sandbox.

| Who | Can | Cannot |
|---|---|---|
| Any authenticated DSH browser | Everything the DSH host operator can, which is the same trust level as `dsh web` itself | — |
| Observer | Read terminal output and state | Send input |
| Controller | Type into the panes it holds a lease on | Hold more than `maxControllers` leases. Replay unconfirmed input after a disconnect. |
| The model | `inspect` binds the session project path, then reads that workspace. `launch` starts approved agents after your approval and sends them nothing. `action` changes that workspace after approval. | Use another conversation or the focused workspace. Send a prompt or raw keystrokes. Adopt or close unrelated external resources. |
| `readOnly: true` | Read and observe | Control, create, close |

- Identity comes from the DSH server (`invocation.peer.id`), never from the browser. Every read, write and stream is authorized on the server.
- Terminal output is parsed by xterm as bytes, never as HTML. OSC 52 clipboard writes are blocked, and paste requires confirmation.
- Data files use `0700`/`0600` modes. Audit records metadata only, never keystrokes, output, environment or credentials.
- This is a single-user, local product. Keep the DSH port on a trusted device or private network. Do not share the launch URL, because it contains a one-time token.

Details: [docs/security.md](docs/security.md).

## Compatibility

| Component | Verified | Not verified |
|---|---|---|
| OS | Linux x86_64 (Ubuntu 24.04 CI runner; Debian 13 for this README's recordings) | macOS, native Windows, WSL |
| DSH | 0.2.1-rc.2 | 0.2.1-alpha.x and other versions |
| Herdr | 0.9.3, protocol 22 | Other versions (shown as incompatible, writes refused) |
| Node.js | 24.22.0 in CI, 24.22.1 locally | Node 25+ (outside `engines`) |
| Browser | Chromium (Playwright 1.64.1), Google Chrome | Firefox, Safari (not automated) |

See [docs/support.md](docs/support.md) and [docs/acceptance.md](docs/acceptance.md).

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Get started" dialog blocks the page | Press <kbd>Esc</kbd>. Workbench works without a DeepSeek account. Only chat and tool approval need one. |
| Workbench shows **Offline** | Herdr is not running, or the socket differs. Start `herdr` (or **Start service**) and make `socket` match `herdr status` → `api socket`. |
| Custom `XDG_CONFIG_HOME` / `HERDR_SOCKET_PATH` | Export the same variables for both `herdr` and `dsh web`, or set `socket` explicitly. |
| **Incompatible** protocol | Install Herdr 0.9.3 (protocol 22). Other protocols are not written to. |
| "Unable to create default workspace" toast in DSH | DSH has no project folder yet. Click **Add workspace** in the DSH sidebar and pick a folder. |
| Pane state is always *Idle* / *Unknown* | Agent states come from supported agent CLIs (Claude Code, Codex) running in Herdr panes. Plain shells stay idle. |
| `dsh plugin add` prints peer-dependency warnings | Expected. DSH provides those packages. |
| `pnpm test:e2e` cannot find a browser | Run `pnpm exec playwright install chromium`. |

## Upgrading

`@namewta/dsh-workbench` 1.x **replaces** both the earlier `@namewta/dsh-plugin-herdr` 0.0.x and the upstream `dsh-plugin-herdr`. It is not an in-place update:

- Old configuration keys, tool names (the old `herdr_*` tools), exports and presets are not supported, and there is no migration layer.
- Installing the new package does not remove the old one. To stop using it: `dsh plugin --profile web remove @namewta/dsh-plugin-herdr` (or `dsh-plugin-herdr`), then restart the profile. Herdr workspaces, panes and DSH profiles are not touched.
- Uninstall Workbench with `dsh plugin --profile web remove @namewta/dsh-workbench`. External agents keep running, and the data directory is kept for you to back up or delete.

More: [docs/installation.md](docs/installation.md) · [docs/provenance.md](docs/provenance.md).

## Development

Requires Node 24.22.0 and pnpm 10.28.2.

```sh
pnpm install --frozen-lockfile
pnpm quality            # build, typecheck, architecture/protocol/contract checks, unit, component and package tests
pnpm dev                # dev workbench with mock data (shows a DEVELOPMENT FIXTURE banner); no DSH or Herdr needed
HERDR_TEST_BINARY=/abs/path/to/herdr-0.9.3 pnpm test:integration   # real Herdr
pnpm exec playwright install chromium && pnpm test:e2e
pnpm pack:plugin        # builds, then writes artifacts/namewta-dsh-workbench-<version>.tgz
node tooling/check-package.mjs artifacts/*.tgz
```

<details>
<summary>Repository layout</summary>

```text
apps/dsh-plugin           distributable package and assembly entry
apps/dev-workbench        mock host without DSH or Herdr
packages/platform-*       neutral contracts, module runtime, permissions, operations, audit ports
packages/module-sdk       manifest, contributions, lifecycle and storage interfaces
packages/ui               the shared UI entry: theme, density, forms, overlays
packages/workbench-shell  navigation, command palette, module management, settings, audit
adapters/dsh              DSH slots, Remote, tools and persistence adapter
modules/herdr             Herdr domain, application, infrastructure and web features
modules/example-notes     second module that proves the SDK; not shipped
```

Herdr is the first Workbench module. See [docs/architecture.md](docs/architecture.md) and [docs/module-guide.md](docs/module-guide.md).
</details>

## Contributing

Issues and pull requests are welcome at [NAMEWTA/dsh-plugin-herdr](https://github.com/NAMEWTA/dsh-plugin-herdr/issues). Before changing code, read [AGENTS.md](AGENTS.md) (boundaries, safety rules, verification), [docs/architecture.md](docs/architecture.md) and [docs/testing.md](docs/testing.md). Run `pnpm quality` and the real-Herdr integration suite before opening a PR. A missing prerequisite counts as a failure, not a skip.

## License & credits

[MIT](LICENSE) © 2026 NAMEWTA, © 2026 sunny0826.

- Built on [sunny0826/dsh-plugin-herdr](https://github.com/sunny0826/dsh-plugin-herdr), the original Herdr plugin for DSH. Retained protocol transport and terminal lifecycle code derives from it under MIT. Thank you, sunny0826.
- Interaction ideas borrowed from [Ovis](https://github.com/devswha/ovis) (MIT). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [NOTICE](NOTICE).
- [Herdr](https://github.com/herdrdev/herdr) and [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) are external projects. This project is not affiliated with them.
- Release tarballs include `NOTICE`, bundled dependency licenses, a CycloneDX SBOM and `build.json` with the source commit.
