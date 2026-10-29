import { test, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Workbench } from '@workbench/shell'
import { herdrWeb } from '@workbench/herdr/web'
import { createDemo } from '../../apps/dev-workbench/src/mock.ts'
import type { WorkbenchClient } from '@workbench/contracts'
vi.mock('../../modules/herdr/src/web/terminal/driver.ts', () => ({loadTerminal: async () => ({})}))
vi.mock('../../modules/herdr/src/web/terminal/screen.tsx', () => ({TerminalScreen: () => <div data-testid="terminal-renderer"/>}))

async function start(scenario = 'bound', projectPath?: string) {
  const demo = await createDemo(scenario)
  const request = vi.fn(demo.client.request.bind(demo.client))
  const view = render(<Workbench client={{...demo.client, request: request as WorkbenchClient['request']}} modules={[herdrWeb]} initialRoute="herdr.overview" locale="en" conversationId="demo-conversation" {...projectPath ? {projectPath} : {}}/>)
  await screen.findByRole('heading', {level: 1})
  return {request, async close() {view.unmount(); await demo.dispose()}}
}

test('a conversation with no owned terminals does not show the header trigger', async () => {
  const d = await start('unlinked')
  try {
    await screen.findByRole('heading', {name: 'Your agent workspace'})
    expect(screen.queryByRole('button', {name: /terminals/})).toBeNull()
  } finally { await d.close() }
})

test('the right rail lists the bound project workspace and opens a pane read-only', async () => {
  const d = await start()
  try {
    const rail = within(await screen.findByRole('region', {name: 'Herdr'}))
    expect(rail.getByText(/Project path \/demo\/workbench/)).toBeTruthy()
    expect(rail.getByText('Workbench')).toBeTruthy()
    expect(rail.getByText(/Subagent · demo-subagent/)).toBeTruthy()
    const closed = rail.getByRole('button', {name: /旧构建终端/})
    expect((closed as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(rail.getByRole('button', {name: /API · 请求校验/}))
    await screen.findByTestId('terminal-renderer')
    const opens = d.request.mock.calls.filter(([call]) => call.operation === 'herdr.terminal.open')
    expect(opens).toHaveLength(1)
    expect(opens[0]![0].input).toMatchObject({mode: 'observe', confirmed: false, takeover: false})
    expect(d.request.mock.calls.some(([call]) => call.operation === 'herdr.resource.close' || call.operation === 'herdr.resource.adopt')).toBe(false)
    expect(screen.getByRole('button', {name: /terminals/})).toBeTruthy()
  } finally { await d.close() }
})

test('the unbound right rail binds the session project path without a click', async () => {
  const d = await start('unlinked', '/demo/workbench')
  try {
    const rail = within(await screen.findByRole('region', {name: 'Herdr'}))
    await waitFor(() => expect(d.request.mock.calls.filter(([call]) => call.operation === 'herdr.conversation.ensure').length).toBeGreaterThanOrEqual(1))
    const ensured = d.request.mock.calls.filter(([call]) => call.operation === 'herdr.conversation.ensure')
    expect(ensured.every(([call]) => call.input && typeof call.input === 'object' && (call.input as {origin?: string}).origin === 'ui')).toBe(true)
    expect(ensured[0]![0].input).toMatchObject({cwd: '/demo/workbench', confirmed: true, label: 'workbench', conversationId: 'demo-conversation', origin: 'ui'})
    expect(d.request.mock.calls.some(([call]) => call.operation === 'herdr.conversation.create' || call.operation === 'herdr.workspace.create')).toBe(false)
    expect(rail.queryByRole('heading', {name: 'This session has no workspace yet'})).toBeNull()
    await rail.findByRole('button', {name: /Idle · Shell · Created in the UI/})
    expect(rail.getByText('workbench', {exact: true})).toBeTruthy()
    expect(rail.getByText(/Project path \/demo\/workbench/)).toBeTruthy()
    expect(rail.getByText('Tab 1')).toBeTruthy()
    expect(rail.queryByText(/Unknown/)).toBeNull()
    await waitFor(() => expect(d.request.mock.calls.some(([call]) => call.operation === 'herdr.session.record')).toBe(true))
    const recorded = d.request.mock.calls.filter(([call]) => call.operation === 'herdr.session.record')
    const entries = recorded.at(-1)![0].input as {entries: Array<{role: string; origin: string}>}
    expect(entries.entries.some(entry => entry.role === 'terminal' && entry.origin === 'ui')).toBe(true)
    await waitFor(() => expect(screen.getByRole('button', {name: '1 terminals'})).toBeTruthy())
  } finally { await d.close() }
})

test('the unbound right rail does not create a workspace without a project path', async () => {
  const d = await start('unlinked')
  try {
    const rail = within(await screen.findByRole('region', {name: 'Herdr'}))
    expect(rail.getByRole('heading', {name: 'This session has no workspace yet'})).toBeTruthy()
    expect(rail.getByText('This session has no project path, so a workspace cannot be created here.')).toBeTruthy()
    const button = await rail.findByRole('button', {name: 'Create and bind a workspace for this path'})
    await waitFor(() => expect(d.request.mock.calls.some(([call]) => call.operation === 'herdr.binding.get')).toBe(true))
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(button)
    expect(d.request.mock.calls.some(([call]) => call.operation === 'herdr.conversation.create' || call.operation === 'herdr.conversation.ensure' || call.operation === 'herdr.workspace.create')).toBe(false)
    await userEvent.click(await rail.findByRole('button', {name: 'Open the Workbench page'}))
    await screen.findByRole('heading', {level: 1, name: 'Workspaces'})
  } finally { await d.close() }
})

test('the host locale replaces a stored language preference', async () => {
  localStorage.setItem('namewta.workbench.preferences.v1', JSON.stringify({version: 1, locale: 'zh', theme: 'light', density: 'comfortable'}))
  const demo = await createDemo('bound')
  const view = render(<Workbench client={demo.client} modules={[herdrWeb]} initialRoute="herdr.overview" locale="en" conversationId="demo-conversation"/>)
  try {
    await screen.findByRole('heading', {name: 'Your agent workspace'})
    expect(screen.queryByRole('heading', {name: '你的 Agent 工作室'})).toBeNull()
    view.rerender(<Workbench client={demo.client} modules={[herdrWeb]} initialRoute="herdr.overview" locale="zh" conversationId="demo-conversation"/>)
    await screen.findByRole('heading', {name: '你的 Agent 工作室'})
    await waitFor(() => expect(within(screen.getByRole('region', {name: 'Herdr'})).getByText(/界面创建/)).toBeTruthy())
  } finally {
    view.unmount()
    localStorage.removeItem('namewta.workbench.preferences.v1')
    await demo.dispose()
  }
})

test('a project path does not leave the right rail on the empty state', async () => {
  const d = await start('unlinked', '/demo/workbench')
  try {
    const rail = within(await screen.findByRole('region', {name: 'Herdr'}))
    await rail.findByRole('button', {name: /Idle · Shell · Created in the UI/})
    expect(rail.queryByRole('button', {name: 'Open the Workbench page'})).toBeNull()
    expect(rail.queryByRole('button', {name: 'Create and bind a workspace for this path'})).toBeNull()
  } finally { await d.close() }
})
