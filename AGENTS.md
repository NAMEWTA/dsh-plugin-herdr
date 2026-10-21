# Workbench contributor guide

Read `docs/architecture.md`, `docs/security.md`, `docs/acceptance.md` and the relevant module before changing code. The approved scope and 89 requirements are in `docs/design-baseline.md` and `docs/requirements-status.csv`.

## Boundaries

- `platform-core` must not import DSH, React, Herdr or business modules. Module code must not import the DSH adapter.
- Host and Web code communicate only through environment-neutral contracts. Use public workspace exports; no cross-package source paths.
- Modules use `@workbench/ui` for shared controls, tokens and portals. Do not add another component primitive system.
- Only reviewed first-party modules are compiled into the product. SDK restrictions are not a sandbox against malicious code.
- Use DSH public slots and Remote interfaces. Never read React Fiber, hashed host class names, or mutate host DOM/branding.
- This is a breaking replacement. Do not restore old package aliases, configs, exports, tools, presets, DOM patches or version matrices.

## Safety and lifecycle

All reads and writes require server-derived identity and scope. Client claims cannot grant permission. Keep schemas, Remote arity and generated descriptors single-source.

Resource labels are not ownership. Check connection/session/epoch/instance before writes. External resources need explicit adoption. Missing conversation bindings fail closed; never fall back to a focused workspace.

Terminal observation is read-only. Control, takeover and resource destruction are separate actions. Never replay uncertain input. Preserve generation/sequence/full-frame semantics, byte order, quotas and process-exit accounting. Closing UI or disabling a module releases bridges, not external agents.

Own subscriptions, timers and processes through module lifecycle. Do not swallow failed cleanup and pretend quota was freed. Raw terminal output, keystrokes and credentials do not belong in audit or diagnostics.

## Verification

Use Node 24.22.0 and pnpm 10.28.2. Run `pnpm quality`, the real Herdr integration suite, HTTP Playwright fixtures and final-package DSH acceptance. `HERDR_TEST_BINARY` must identify the pinned binary; missing prerequisites are failures, not skips. Do not delete failing assertions just to make CI green.

Preserve MIT attribution. Do not publish, overwrite releases, force-push main, detach/rename the repository or delete profiles/workspaces without explicit maintainer authorization. Document unverified platforms, manual IME/screen-reader checks and performance gates honestly. Do not turn a past test result into evidence for a different source SHA.
