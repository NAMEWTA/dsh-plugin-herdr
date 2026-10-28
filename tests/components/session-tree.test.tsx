import { test, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Workbench } from '@workbench/shell'
import { herdrWeb } from '@workbench/herdr/web'
import { createDemo } from '../../apps/dev-workbench/src/mock.ts'
import type { WorkbenchClient } from '@workbench/contracts'
vi.mock('../../modules/herdr/src/web/terminal/driver.ts', () => ({loadTerminal: async () => ({})}))
vi.mock('../../modules/herdr/src/web/terminal/screen.tsx', () => ({TerminalScreen: () => <div data-testid="terminal-renderer"/>}))

async function start(scenario = 'bound') {
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
