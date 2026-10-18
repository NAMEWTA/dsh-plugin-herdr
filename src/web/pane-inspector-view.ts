import { createElement as h } from 'react'
import { t, useHerdrLang } from './i18n.ts'
import type { HerdrEnvironmentReport } from '../core/environment.ts'
import { inspectorCommands, type InspectedPane, type PaneBinding, type InspectorCommandId } from './pane-inspector-model.ts'

export interface PaneInspectorViewProps {
  selected: InspectedPane
  binding: PaneBinding
  report: HerdrEnvironmentReport | null
  checking: boolean
  opening: boolean
  feedback: 'copied' | 'copyFailed' | null
  onOpen: () => void
  onCopy: (command: string) => void
  onRefresh: () => void
  onClose: () => void
}

/** No remote actions in the presentation layer; all CLI snippets are copy-only. */
export function PaneInspectorView({ selected, binding, report, checking, opening, feedback, onOpen, onCopy, onRefresh, onClose }: PaneInspectorViewProps) {
  void useHerdrLang()
  const { pane, workspace, cwd, tabId } = selected
  const commands = inspectorCommands(report, pane.pane_id, selected)
  const fact = (key: Parameters<typeof t>[0], value: string | null | undefined) =>
    h('div', { key }, h('dt', null, t(key)), h('dd', { style: { overflowWrap: 'anywhere', marginInlineStart: 0 } }, value || t('dashboard.unknown')))
  const commandLabel = (id: InspectorCommandId) => t(`inspector.command.${id}`)
  return h('section', { className: 'herdr-dash-card', 'aria-label': t('inspector.title'), 'data-pane-inspector': pane.pane_id },
    h('header', { style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' } },
      h('h2', { style: { flex: 1 } }, t('inspector.title')),
      h('button', { type: 'button', onClick: onClose, 'aria-label': t('inspector.close') }, t('view.close'))),
    h('dl', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 } },
      fact('inspector.paneId', pane.pane_id), fact('inspector.workspaceId', workspace.workspace_id),
      fact('inspector.tabId', tabId), fact('inspector.label', pane.label), fact('inspector.status', pane.status),
      fact('inspector.agent', pane.name || pane.kind), fact('inspector.cwd', cwd),
      fact('dashboard.checkoutBase', workspace.checkout_path_base), fact('setup.socketPath', report?.connection.socketPath),
      fact('setup.session', report?.connection.session), fact('inspector.dshSession', binding.state === 'bound' ? binding.sessionId : null)),
    h('p', { role: 'status' }, t(`inspector.binding.${binding.state}`)),
    h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
      h('button', { type: 'button', disabled: binding.state !== 'bound' || opening, onClick: onOpen }, t(opening ? 'inspector.opening' : 'inspector.open')),
      h('button', { type: 'button', disabled: checking, onClick: onRefresh }, t(checking ? 'dashboard.checking' : 'inspector.refresh'))),
    h('h3', null, t('inspector.commands')),
    h('p', null, t('inspector.hostNotice')),
    h('p', null, t('inspector.layoutNotice')),
    commands.length === 0 ? h('p', { role: 'status' }, t(checking ? 'dashboard.checking' : 'inspector.commandsUnavailable')) : null,
    ...commands.map(({ id, command }) => h('article', { key: id, 'data-inspector-command': id },
      h('h4', null, commandLabel(id)),
      h('pre', { tabIndex: 0, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' } }, h('code', null, command)),
      h('button', { type: 'button', onClick: () => onCopy(command), 'aria-label': t('setup.copyNamed', { name: commandLabel(id) }) }, t('setup.copy')))),
    h('p', { role: feedback === 'copyFailed' ? 'alert' : 'status', 'aria-live': 'polite' }, feedback ? t(feedback === 'copied' ? 'setup.copied' : 'setup.copyFailed') : ''))
}
