# Herdr Workspace Studio — UI and session workflow revision

## Interaction decisions

This change follows the requested narrow icon rail → module navigation → resource hierarchy. The rail is a disclosure, not a second page menu. Selecting Herdr opens its own navigation without changing the current page; selecting an item or workspace/pane performs navigation. Selecting the same rail icon collapses/expands its menu. Bottom **Workbench settings** opens a separate administrative menu (appearance, modules, audit). There are no audit or system-management links inside the Herdr menu.

Herdr contributes `navigation` and `icon` through the neutral WebModule contract. Neither the shell nor the UI package imports Herdr. Future modules can contribute their own navigation, while modules without it retain the generic navigation fallback. The example notes module remains a development fixture, excluded from the released plugin.

Visual language: restrained neutral surfaces, subtle borders, roomy typography, small green active-rail accents, soft hover/selection transitions and consistent light/dark/compact variants. No copied ChatGPT branding, proprietary assets, or host DOM modifications. Reduced-motion preferences disable the rail hover movement. Narrow containers use the same Base UI modal primitive for a keyboard-trapped secondary drawer; Escape closes it and restores focus.

## Workspaces → tabs → panes

The Herdr sidebar contains overview, attention and agents, followed by a searchable expandable workspace/tab/pane hierarchy and connection settings at the bottom. Collapsed workspace children are not rendered. A bound conversation's workspace is prioritized and marked. Search matches names, IDs, agent kinds and working directories; an empty search result is not confused with a connection failure.

The overview is a workspace studio rather than a grid of infrastructure metrics. Workspace cards show their panes directly with state and agent information. A pane's default click opens its real terminal in **read-only observation**, without requiring an extra Observe click. Workspace details preserve tab management, rename/close, pane split and agent start; less frequent actions live under **Manage pane**.

**Control is distinct from viewing.** The keyboard/control shortcut asks for explicit confirmation before requesting a controller lease. Cancelling performs no control or adoption. External panes explicitly explain that only the selected pane will be adopted; no workspace or sibling pane is implicitly adopted. Existing controllers are never displaced unless the person separately confirms takeover. Selecting a pane again in view mode releases this UI's previous control and starts an observer. URL `intent=control` can request a confirmation dialog, never authority.

Old/stale resources remain visible with disabled entry controls. Late lease responses after navigation are released instead of attaching to a different page. Closing the UI releases bridges, never the underlying agent processes. Terminal stream generation, sequence, ACK, quotas and no-input-replay invariants are preserved.

## DSH conversation workflow

The pinned DSH 0.2.1-alpha.2 public `conversation.view` slot supplies `SessionStandardProps.sessionId`. Its `SessionListState` has no `current` property. The adapter now receives the slot's session ID directly; it no longer guesses selection from the catalog. Changing the conversation recreates its client and resets page/terminal state. Missing identity fails closed. Workbench URL state is tagged with its conversation context so a different conversation does not inherit a prior pane selection.

An unbound conversation can explicitly select an existing workspace, or choose **Create for this conversation** in the New workspace form (selected by default in an unbound conversation). The backend performs creation and binding in one idempotent, serialized operation, `herdr.conversation.create`. It rejects duplicate/concurrent creation and never silently replaces a binding. If persistence fails after creation, the result is explicitly uncertain; the created workspace is retained, not destructively rolled back.

The human-approved `workbench_herdr_action` tool now accepts `herdr.workspace.create` with `{label,cwd}` for an unbound conversation. The adapter derives the conversation identity from the executing agent; the bridge uses the same create-and-bind operation. `workbench_herdr_inspect` then exposes that exact workspace and its initial tab/pane. Existing binding and resource-instance validation remains in force. Manual CLI activity is not guessed to belong to a conversation: explicitly link its workspace from the UI. Human approval is outside model-controlled JSON.

## References reviewed

- Original upstream [`sunny0826/dsh-plugin-herdr`, `src/client-logic.ts`](https://github.com/sunny0826/dsh-plugin-herdr/blob/main/src/client-logic.ts): workspace/tab/pane grouping, natural ordering and truthful five-state presentation. Its public README describes session-scoped UI. This change reimplements the interaction in the new SDK; it does not restore old aliases, private Fiber/DOM patches or the old preset.
- [`devswha/herdr-web-ui`](https://github.com/devswha/herdr-web-ui) and its [user guide](https://github.com/devswha/herdr-web-ui/blob/main/docs/guide.md): workspace/tab/pane hierarchy, direct terminal access and resource-local management. Used for workflow inspiration, not wholesale feature claims or copied code.
- [Herdr concepts](https://herdr.dev/docs/concepts/): a workspace contains tabs and real terminal panes; observation must not terminate the underlying process.
- Installed, pinned DSH declarations: `@deepseek-ai/dsh-client-ui-session/lib/types/client/index.d.ts` (`SessionStandardProps`), `@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.d.ts` (`SessionListState`), and `@deepseek-ai/dsh-agent/lib/types/types.d.ts` (agent ID is SessionId).

## Acceptance evidence

The PR must run the unchanged full acceptance pipeline on its own head: strict build/types/architecture/contracts, unit/component/packaging, real Herdr and real HTTP browser fixtures, then installation of the exact package into published DSH. Added regressions cover rail disclosure vs navigation, administrative separation, direct read-only entry, explicit/targeted control and adoption, session switching, create-and-bind, late lease reclamation, public session-slot identity and mobile drawer focus. Browser screenshots and axe reports are CI artifacts, not mockup renders. The real DSH test verifies default read-only entry and two-client control conflict/takeover; no model API call is made. Physical IME, touch/screen-reader and cross-platform acceptance remain as documented in `acceptance.md`.

This revision is a new PR. It does not authorize another merge, release, repository rename or upstream fork detachment.
