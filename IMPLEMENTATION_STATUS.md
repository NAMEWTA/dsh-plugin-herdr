# Review hardening — merged into `main`

Recovered on 2026-10-11 from a Git tree uploaded during an earlier implementation session
(base `3ebefe27`), then merged into `main` on 2026-10-18 together with the environment
management work that had landed there in the meantime.

## What was merged

The hardening branch introduced a contract-first architecture:

- `src/contracts/` holds one runtime source of truth (`PANEL_DEFINITIONS`) that generates
  both the Typert gateway codecs and the typed Web remote projection.
- `src/host/application/` holds policies (resource authorization, session bindings, agent
  launch) separately from the transport adapters that call them.
- `src/host/status-tracker.ts` reconciles snapshots; `src/host/status.ts` is now only the
  Cordis wiring around it.
- `src/web/features/terminal/` splits the xterm glue into a frame writer, an input queue, a
  remote transport and a session store.

## Merge reconciliation

Nine files conflicted. The resolved result keeps the hardening architecture and re-adds the
`environment` capability that had landed on `main`:

- `environment` is the 18th panel contract method, validated by the strict
  `environmentSchema` used by the diagnostics reader, and declared in `PANEL_NO_REQUEST`
  so it carries no request codec on the wire.
- `findHerdrExecutable` (which rejects relative `PATH` entries and falls back to
  `~/.local/bin`) is now the single executable resolver for diagnostics, server start,
  terminal processes and `TERMINAL_BIN_PATH`.
- Terminal runtime keeps `invalidateProbe()` from `main` alongside the hardening's
  idempotent `dispose()`.

## Behaviour recovered during reconciliation

These were regressions introduced by the partial migration and are fixed here:

- `herdr_agent_start` waits for the first stable agent state again instead of returning on
  `status: unknown`, which previously caused `agent_not_ready` on an immediate prompt.
- `session-mode` reports `idle → working → idle` in order. Reports carry their state
  explicitly, a turn that ended while binding keeps `idle`, and concurrent binds report once.
- `NDJSONParser` skips an oversized line and keeps parsing, rather than discarding every
  line framed in the same chunk.
- Dashboard process probing is throttled on the local clock, not on the sample's
  `sampled_at`, so a stale timestamp cannot force a probe on every cycle.

## Validation status

Run on Node 24.21.0 at the merge commit:

- `pnpm quality` — build (Host, Typert, Web), `tsc --noEmit`, generated-contract drift
  check, **504/504 unit tests**, **10/10 packaging tests**.

Not yet verified on this commit (require a real host or credentials):

- A real DSH Web load/unload cycle against the supported 0.2.x releases.
- Real Herdr terminal streams, multi-window disconnects, cancellation and reconnect screen
  equivalence (`pnpm test:integration` with a live Herdr).
- Browser acceptance runs in CI.

Do not treat the local `quality` result as a substitute for those checks.
