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
    h('div', { key, className: 'herdr-inspector-fact', 'data-wide': ['inspector.cwd', 'dashboard.checkoutBase', 'setup.socketPath'].includes(key) || undefined }, h('dt', null, t(key)), h('dd', null, value || t('dashboard.unknown')))
  const commandLabel = (id: InspectorCommandId) => t(`inspector.command.${id}`)
  return h('section', { className: 'herdr-dash-card herdr-inspector', 'aria-label': t('inspector.title'), 'data-pane-inspector': pane.pane_id },
    h('header', { className: 'herdr-inspector-head' },
      h('h2', null, t('inspector.title')),
      h('button', { type: 'button', className: 'herdr-button', onClick: onClose, 'aria-label': t('inspector.close') }, t('view.close'))),
    h('dl', { className: 'herdr-inspector-facts' },
      fact('inspector.paneId', pane.pane_id), fact('inspector.workspaceId', workspace.workspace_id),
      fact('inspector.tabId', tabId), fact('inspector.label', pane.label), fact('inspector.status', pane.status),
      fact('inspector.agent', pane.name || pane.kind), fact('inspector.cwd', cwd),
      fact('dashboard.checkoutBase', workspace.checkout_path_base), fact('setup.socketPath', report?.connection.socketPath),
      fact('setup.session', report?.connection.session), fact('inspector.dshSession', binding.state === 'bound' ? binding.sessionId : null)),
    h('p', { className: 'herdr-inspector-binding', role: 'status', 'data-binding': binding.state }, t(`inspector.binding.${binding.state}`)),
    h('div', { className: 'herdr-inspector-actions' },
      h('button', { type: 'button', className: 'herdr-button', disabled: binding.state !== 'bound' || opening, onClick: onOpen }, t(opening ? 'inspector.opening' : 'inspector.open')),
      h('button', { type: 'button', className: 'herdr-button', disabled: checking, onClick: onRefresh }, t(checking ? 'dashboard.checking' : 'inspector.refresh'))),
    h('div', { className: 'herdr-inspector-command-intro' },
    h('h3', null, t('inspector.commands')),
    h('p', null, t('inspector.hostNotice')),
    h('p', null, t('inspector.layoutNotice'))),
    commands.length === 0 ? h('p', { role: 'status' }, t(checking ? 'dashboard.checking' : 'inspector.commandsUnavailable')) : null,
    h('div', { className: 'herdr-inspector-command-grid' }, ...commands.map(({ id, command }) => h('article', { key: id, className: 'herdr-inspector-command', 'data-inspector-command': id },
      h('header', null,
        h('h4', null, commandLabel(id)),
        h('button', { type: 'button', className: 'herdr-button', onClick: () => onCopy(command), 'aria-label': t('setup.copyNamed', { name: commandLabel(id) }) }, t('setup.copy'))),
      h('pre', { tabIndex: 0 }, h('code', null, command))))),
    h('p', { className: 'herdr-inspector-feedback', role: feedback === 'copyFailed' ? 'alert' : 'status', 'aria-live': 'polite' }, feedback ? t(feedback === 'copied' ? 'setup.copied' : 'setup.copyFailed') : ''))
}

