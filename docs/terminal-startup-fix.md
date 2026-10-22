# Terminal startup failure: investigation and regression coverage

## Observed report and evidence boundary

The report shows a disconnected terminal and the generic Chinese INTERNAL_ERROR text, without a request ID. That screenshot does not expose a URL, browser console, network trace, or server logs; it cannot prove the exact failing request on the reporter's installation. No remote access to that installation was available. This change fixes concrete startup defects and adds a reproducible released-package failure case rather than claiming to have inspected private deployment logs.

## Failure path in 1.0.1-alpha.1

`apps/dsh-plugin/src/client.tsx` configured the renderer using dynamic `import(new URL('/_workbench/assets/' + BUILD.sha + '/terminal.js', window.location.origin))`. This assumes an additional website-root endpoint is delivered alongside DSH's public plugin client. If a proxy only forwards the host's public routes, an older browser bundle references a removed build-specific URL, or that extra resource cannot be loaded, the import rejects. `PaneSession.open` awaits this import before `herdr.terminal.open`, so no terminal lease has been requested yet. The native error has no domain code or server request ID. `ErrorNotice` previously converted it to INTERNAL_ERROR while telling the user to retain a nonexistent request ID.

The packaged-client regression serves the actual released client under a nested page and deliberately does not provide the private root asset route. The expected old result is exactly one failed terminal asset request, the reported Chinese generic error, and zero terminal-open calls. This is a targeted reproduction of the failure mode, not proof of the reporter's proxy configuration. The same harness must successfully open read-only xterm with the new final package, without requesting that route. Its host data is explicitly a fixture; the separate installed-DSH gate uses real Herdr.

## Fixes

- Deliver xterm and FitAddon through the same public DSH client artifact. The local deferred import is compiled into that artifact (`codeSplitting: false`), without another runtime fetch. Remove the private root asset handler and unused standalone terminal artifact. Construct terminals only when a pane is opened. No CSP weakening, blob/eval fallback, extra proxy route, second React renderer, or authority change.
- Validate renderer exports, share a single successful initialization, and allow retry after failure. Track registrations by identity so out-of-order application disposal never restores an already disposed loader.
- Distinguish `TERMINAL_RENDERER_UNAVAILABLE` and `TERMINAL_INITIALIZATION_FAILED` from gateway and server failures. Keep real request IDs when present; local failures get a stable diagnostic code, not a fabricated server ID. Raw URLs, stack traces, terminal content and credentials are not exposed.
- Register cleanup immediately after creating each renderer resource. If canvas/addon initialization throws, dispose the partially initialized terminal and release its existing lease. Read-only retry never implicitly adopts a resource, acquires a controller, takes over another client, or replays input.

## Tradeoff

The public browser artifact now includes the terminal library, so its initial transfer is larger. Renderer construction, terminal streams and resource acquisition remain deferred. This intentionally favors a reliable single delivery path over a second deployment-sensitive asset request. The package still contains one copy of xterm and reuses host React. It does not claim a performance improvement.

## Required evidence

- Loader unit regressions fail against the old implementation and pass after the fix (unconfigured, invalid exports, failed load/retry, single flight, out-of-order disposal, still-live previous registration).
- Component checks: failed load has no lease or adoption; retry is read-only; partial initialization disposes once and releases; actual stream request ID/code survive.
- Frozen-lockfile install, full build/types/architecture/contracts/unit/component/package gates remain enabled.
- In GitHub's browser job, download the immutable historical 1.0.1-alpha.1 tarball and verify SHA-256 `a62ad41017071b3f068576836f81fadfd52f94001171ca47ecfc59cbfb4c8a94`; reproduce before and test the same run's new final tarball after.
- Real published DSH installation also blocks the removed private asset route. Normal read-only entry, input/ACK, two-client explicit takeover, anonymous/foreign-Origin rejection and non-destructive uninstall must pass.

Local HTTP browser execution is blocked by the assistant runtime policy; authoritative browser evidence comes from GitHub Actions, not a policy workaround. Physical IME/touch/screen-reader and unsupported-platform limits remain as documented.
