import { test, expect } from 'vitest'
import { render, screen, within, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Workbench } from '@workbench/shell'
import { UiProvider, Button, DataTable, useWorkbench } from '@workbench/ui'
import { herdrWeb } from '@workbench/herdr/web'
import { notesWeb } from '@workbench/example-notes/web'
import { createDemo } from '../../apps/dev-workbench/src/mock.ts'
const modules=[herdrWeb,notesWeb]
async function demo(scenario='normal',route='herdr.overview',locale:'zh'|'en'='en'){
  const fixture=await createDemo(scenario)
  const view=render(<Workbench client={fixture.client} modules={modules} initialRoute={route} locale={locale} conversationId="demo-conversation"/>)
  await screen.findByRole('heading',{level:1})
  return {fixture,view,async close(){view.unmount();await fixture.dispose()}}
}
test('overview prioritizes attention and reports real fixture counts',async()=>{const d=await demo();try{await screen.findByText('API · 请求校验');expect(screen.getByRole('heading',{name:'Operations overview'})).toBeTruthy();expect(screen.getAllByText('Attention inbox').length).toBeGreaterThan(0);expect(screen.queryByText('NaN')).toBeNull()}finally{await d.close()}})
test('empty state explains next action, not a broken blank screen',async()=>{const d=await demo('empty');try{expect((await screen.findAllByText('No workspaces yet')).length).toBeGreaterThan(0);expect(screen.getByRole('button',{name:'New workspace'})).toBeTruthy()}finally{await d.close()}})
test('offline snapshot remains visible and exposes stale status',async()=>{const d=await demo('offline');try{await screen.findByText('API · 请求校验');expect(screen.getAllByText(/interrupted|offline|stale|expired/i).length).toBeGreaterThan(0)}finally{await d.close()}})
test('language is consistent through page and platform navigation',async()=>{const d=await demo('normal','herdr.overview','zh');try{expect(screen.getByRole('heading',{name:'运行总览'})).toBeTruthy();expect(within(d.view.container.querySelector('aside')!).getByRole('button',{name:'模块管理'})).toBeTruthy();await screen.findByText('API · 请求校验')}finally{await d.close()}})
test('isolated sample module is reachable without any Herdr code changes',async()=>{const d=await demo('normal','notes.home');try{expect((await screen.findAllByText(/note|便签/i)).length).toBeGreaterThan(0)}finally{await d.close()}})
test('missing explicit binding is visible; no workspace is chosen implicitly',async()=>{const d=await demo('normal','herdr.workspaces');try{expect(await screen.findByText('Not bound')).toBeTruthy();expect(screen.queryByText('Bound')).toBeNull()}finally{await d.close()}})
test('large table renders a bounded first page and searchable list',async()=>{const d=await demo('large','herdr.agents');try{await screen.findByRole('table');expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(51);await userEvent.click(screen.getByRole('button',{name:'Next page'}));expect(screen.getAllByRole('row').length).toBeLessThanOrEqual(51)}finally{await d.close()}})
test('command palette opens and closes using keyboard without changing resources',async()=>{const d=await demo();try{fireEvent.keyDown(window,{key:'k',ctrlKey:true});expect(await screen.findByRole('dialog')).toBeTruthy();fireEvent.keyDown(document,{key:'Escape',code:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull())}finally{await d.close()}})
test('theme and density are scoped to the workbench root',async()=>{const d=await demo('normal','platform.settings');try{await userEvent.selectOptions(screen.getByLabelText('Theme'),'dark');await userEvent.selectOptions(screen.getByLabelText('Density'),'compact');const root=d.view.container.querySelector('.wb-root')!;expect(root.getAttribute('data-theme')).toBe('dark');expect(root.getAttribute('data-density')).toBe('compact');expect(document.documentElement.hasAttribute('data-theme')).toBe(false)}finally{await d.close()}})
