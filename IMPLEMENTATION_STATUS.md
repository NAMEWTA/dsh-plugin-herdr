# Recovered review implementation — NOT READY TO MERGE

Recovered on 2026-10-11 from the Git tree uploaded during the previous implementation session. Base: 3ebefe27a41f239f0a252a37afbbe1e7bc999b50.

This branch preserves the uploaded hardening implementation. It is not a complete release candidate. In particular, the previous session did not commit its complete packaging/CI/documentation changes or finish the full legacy test migration. Its working-copy report recorded 58 focused tests on Node 22.16.0, not a full Node 24/DSH/Herdr/browser acceptance run. That historical result must not be represented as CI passing on this recovered commit.

Before merging:

- Verify every imported module, generated artifact and entry point.
- Reconcile all original tests with the new runtime contracts without dropping coverage.
- Run frozen installation, build, full typecheck, all unit tests and packed-install smoke on Node 24.
- Verify real DSH Web loading/unloading, actual Herdr terminal streams, multi-window disconnects, cancellation and reconnect screen equivalence.
- Complete the remaining documented review findings and update release compatibility evidence.

The original web activation PR #12 is already merged. This recovered hardening work is a separate draft PR and must not be mistaken for #12 or a validated DSH version upgrade.
