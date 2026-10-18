# Dashboard pane inspector

Select an agent or pane in the global Herdr dashboard to inspect its real pane/workspace identifiers, reported state and available metadata. This selection stays in the dashboard, including for ordinary terminal panes without a DSH binding. The separate **Open in DSH** action is enabled only after a binding lookup succeeds, and rechecks the binding before navigating. A failed lookup is distinct from an unbound pane.

Pane working directory, tab ID and endpoint are checked on selection and explicit refresh; pane status and labels continue following dashboard updates. Pane working directory and tab ID are shown only when available from matching topology. The workspace checkout directory is separately labeled; it is never substituted for the pane's working directory. Hidden or disappeared panes lose their inspector actions. The existing host write authorization (`canWritePane`), close confirmations, and terminal control policies are unchanged; no new Remote methods are added.

## CLI correspondence

The inspector provides copy-only, read-only commands for a server snapshot, pane metadata, daemon layout, foreground process information, visible output (up to 80 lines), and registered agent metadata. These target the selected real pane ID, not an agent kind or a display name. An ordinary terminal may have no registered agent record.

Run copied commands in a POSIX shell on the machine hosting DSH. The panel does not execute them. Commands require a verified executable path and a known configured socket or named session. All dynamic arguments are shell-quoted; control characters disable command generation. A resolved socket is passed through `HERDR_SOCKET_PATH`, without `--session`, because Herdr's explicit session argument would override the socket. A named session is used explicitly only when no socket is available. Commands are withheld if the environment report and selected dashboard endpoint disagree.

Browser pane dragging is local display ordering. It does not update the daemon's layout. `pane layout --pane ID` reads that daemon layout.

Verified CLI references (Herdr 0.9.0 / protocol 22):
- [Pane commands](https://github.com/herdrdev/herdr/blob/v0.9.0/src/cli/pane.rs)
- [Agent commands](https://github.com/herdrdev/herdr/blob/v0.9.0/src/cli/agent.rs)
- [Snapshot API](https://github.com/herdrdev/herdr/blob/v0.9.0/src/cli/api.rs)
- [Socket/session precedence](https://github.com/herdrdev/herdr/blob/v0.9.0/src/session.rs)

The overview-plus-inspector organization is inspired by [herdr-web-ui](https://github.com/devswha/herdr-web-ui) (MIT) and the same-daemon companion model of [herdr-gpui](https://github.com/penso/herdr-gpui) (Apache-2.0). This implementation is original; no upstream source, assets or dependency were copied.
