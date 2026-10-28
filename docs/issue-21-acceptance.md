# Native workspace and conversation acceptance (#21)

`tests/e2e/dsh.mjs` installs the final package in the published DSH
`0.2.1-rc.2` host with an isolated, disposable home. Native-host acceptance is
not interchangeable with the Workbench-only browser harness.

The native flow cancels and reopens **Add workspace**, selects an actual isolated
folder through **Select Workspace Directory / Edit path / Open**, and checks the
host-created conversation's public `data-conversation-session` attribute. It
submits a prompt through the native composer, waits for the rendered answer,
opens the public **Workbench** conversation tab, explicitly creates a bound
Herdr workspace, and verifies the binding after reload.

## Model fixture boundary

A loopback-only HTTP Messages fixture supplies deterministic JSON/SSE responses.
The disposable host discovers its dummy, non-secret key and loopback base URL
through the supported `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` launch environment.
No real key, existing user profile, external model, synthetic host session log,
private React state, or private host CSS selector is used. This proves native
conversation lifecycle and plugin binding, **not external-model quality**.
`tests/packaging/local-model.test.mjs` checks both response modes and authentication.

## Diagnostics and closure evidence

The test records console warnings/errors, failed requests (URL origin/path only),
HTTP errors, browser exceptions, and the specific default-workspace toast in
`.evidence/dsh/host-diagnostics.json`. It probes the real `xdg-user-dir DOCUMENTS`
result without replacing the command or fabricating a Documents directory.
Upstream rejects an empty Documents path or a path equal to HOME: an unset Linux
Documents directory can therefore explain the warning independently of this
plugin. The explicit native picker recovery is exercised rather than hiding the
warning or claiming an upstream default-directory fix.

Successful evidence includes `native-workspace.png`,
`native-conversation-binding.png`, `native-conversation.json`, and `result.json`.
The JSON explicitly records `externalModelTested: false`. Source review and local
fixture unit tests alone do not close #21: the final-commit real DSH CI job must
pass this flow and retain its evidence.

## Source grounding

Public UI and launch-environment behavior were inspected at upstream DSH rc.2
commit `687f282e8625c6b8d11ff58211a90524be2e4317`, specifically the directory picker,
`ui-workspace` WorkspaceBrowser, `ui-conversation` ConversationContent,
ConversationSession, EmptyHero, InputBar/DraftEditor and locales, plus
`llm-deepseek-api-key`, `llm-deepseek/config.ts` and `default-directory.ts`.
The Workbench selectors address this repository's own components.
