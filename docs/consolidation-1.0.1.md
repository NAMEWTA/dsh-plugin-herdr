# Branch reconciliation for 1.0.1-alpha.1

The maintainer explicitly requested consolidation into `main`, closure/deletion of other PRs/branches, and a patch increment. Starting main is `ff0feabca813bffd7642e08d9398aa784b4277e4` (PR25 already merged). The existing release is `1.0.0-alpha.1`; incrementing the numeric patch yields **1.0.1-alpha.1**. This is still a prerelease, not npm publication or a stable-support claim.

## Conflict resolution, not a legacy-code restoration

| Source | Reviewed head | Resolution in the modular codebase |
| --- | --- | --- |
| #18 `fix/filesystem-root-path-filter` | `a2f369e8d2843164e9b35dd62e681e5057c047a2` | The old separator helper is replaced by `workspaceDirectory` using `realpath` + `path.relative`. Port regression coverage for filesystem roots, trailing separators, prefix siblings, non-directories and symlink escape. Do not restore deleted `src/core/paths.ts`. Windows remains outside the verified runtime matrix. |
| #20 `fix/panel-no-request-contracts` | `b0142e70cb5e8c89541913abe7d01f7534170bc8` | The old zero-argument RPCs no longer exist. Their mismatch is superseded by the single-request schema-generated Remote contract and the existing final-package arity regression. Keep the new contract; do not revive the old panel namespace. |
| #22 `feat/pane-inspector-cli-bridge` | `55c4455525193f650ea81a652ac77fd199626a80` | Port authoritative pane inspection, actual endpoint/executable, six copy-only readonly commands, POSIX literal escaping, missing/stale/changed-target handling, explicit clipboard failure and browser tests. Implement as `herdr.pane.inspect` + module page, not the old iframe/drawer. Current conversation binding and workspace navigation replace the old reverse pane-to-session UI. Old mock clock/auto-split test adjustments are irrelevant to the replaced agent-start implementation. |
| #24 `refactor/modular-workbench` | `75bc74c4c635c4b6e481416b2a33227a69281a05` | Preserve the already released breaking modular architecture. Include the original branch ancestry because #24 was squashed. |
| #25 `feat/herdr-navigation-studio` | `f701900f948c72c762c9c327119f231c76a58204` | Already an ancestor of starting main. Preserve icon rail, separated administration, session binding and automatic readonly pane entry. |
| `release/consolidate-1.0.1-alpha.1` | `f701900f948c72c762c9c327119f231c76a58204` | Duplicate pointer to #25; no unique source changes to restore. |

The reconciliation commit records the unmerged branch heads as parents, with the tree resolved to the current module structure plus the above ports. It is merged without squashing, so deleting branch names does not discard their committed history. Before each deletion, re-read the ref and ensure the reviewed commit is an ancestor of main. If a branch moved, re-review instead of deleting it. Tags and previous releases are retained.

## Inspector invariants

The query requires trusted `herdr.read` authority and a permitted connection. It validates a full pane reference before and after executable probing. Pane/workspace/tab values come from one current snapshot; absent foreground CWD stays absent. A changed epoch, terminal instance, missing pane or stale daemon fails closed.

Commands target the configured full socket and verified absolute executable. An explicit `--session` is intentionally not combined with `HERDR_SOCKET_PATH`. Unknown or unsupported binaries/endpoints produce no commands. Copy revalidates the target, binary and socket; failure never reports success. There is no command execution button, implicit adoption, terminal input, control acquisition, focus fallback or raw terminal output in audit records. Copied CLI commands are point-in-time conveniences: validate the target again before running them later.

The original default pane action stays readonly viewing; inspection is a separate info action and a command-palette destination. Every pane remains selectable in the inspector, even when a workspace preview is truncated. Metadata, copy-only commands, readonly terminal viewing and actual control remain separate concepts.

## Acceptance

Existing quality, real Herdr, HTTP/a11y, installed DSH, anonymous/Origin rejection, two-client takeover and non-destructive uninstall gates remain mandatory. Added tests cover path semantics, shell literal preservation, rejected stale resources, readonly CLI parity on a disposable real daemon, inspection UI/clipboard failures, four viewport/theme combinations and actual installed-package inspector entry. Do not substitute local baseline tests for final-PR-head CI or merged-main CI. The release workflow verifies exact main SHA and artifact checksums before publishing the already-tested tarball.
