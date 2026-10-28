import { test, expect, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Workbench } from '@workbench/shell'
import { herdrWeb } from '@workbench/herdr/web'
import { createDemo } from '../../apps/dev-workbench/src/mock.ts'
import type { WorkbenchClient } from '@workbench/contracts'
vi.mock('../../modules/herdr/src/web/terminal/driver.ts', () => ({loadTerminal: async () => ({})}))
vi.mock('../../modules/herdr/src/web/terminal/screen.tsx', () => ({TerminalScreen: () => <div data-testid="terminal-renderer"/>}))

async function start(scenario = 'normal') {
  const demo = await createDemo(scenario)
  const request = vi.fn(demo.client.request.bind(demo.client))
  const view = render(<Workbench client={{...demo.client, request: request as WorkbenchClient['request']}} modules={[herdrWeb]} initialRoute="herdr.overview" locale="en" conversationId="demo-conversation"/>)
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

test('the session tree shows this conversation, its subagent and closed history, then opens a read-only dock', async () => {
  const d = await start()
  try {
    const trigger = await screen.findByRole('button', {name: /terminals/})
    await userEvent.click(trigger)
    const tree = within(await screen.findByRole('dialog', {name: 'Session resource ownership'}))
    expect(tree.getByText(/Subagent · demo-subagent/)).toBeTruthy()
    expect(tree.getByText('旧构建终端')).toBeTruthy()
    expect(tree.getAllByText(/Created by a tool/).length).toBeGreaterThan(0)
    const closed = tree.getByRole('button', {name: /旧构建终端/})
    expect((closed as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(tree.getAllByRole('button', {name: /API/})[0]!)
    await screen.findByTestId('terminal-renderer')
    const opens = d.request.mock.calls.filter(([call]) => call.operation === 'herdr.terminal.open')
    expect(opens).toHaveLength(1)
    expect(opens[0]![0].input).toMatchObject({mode: 'observe', confirmed: false, takeover: false})
    expect(d.request.mock.calls.some(([call]) => call.operation === 'herdr.resource.close' || call.operation === 'herdr.resource.adopt')).toBe(false)
    await userEvent.click(screen.getByRole('button', {name: 'Close view'}))
    await waitFor(() => expect(d.request.mock.calls.some(([call]) => call.operation === 'herdr.terminal.release')).toBe(true))
    expect(screen.queryByTestId('terminal-renderer')).toBeNull()
  } finally { await d.close() }
})
