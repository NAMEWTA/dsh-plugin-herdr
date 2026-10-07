import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import {
  HERDR_PRESET_DESCRIPTION_EN,
  HERDR_PRESET_DESCRIPTION_ZH,
  HERDR_PRESET_ID,
  HERDR_PRESET_NAME_EN,
  HERDR_PRESET_NAME_ZH,
  registerHerdrPreset,
} from '../../src/host/preset.ts'

test('registerHerdrPreset registers the herdr preset and removes it on dispose', async () => {
  const ctx = new Context()
  const registered: Array<{ id: string; name?: string; description?: string; plugins: Array<{ name: string; config?: Record<string, unknown> }> }> = []
  let removed = 0
  ctx.provide('agentPresets', {
    register: async (definition: { id: string; name?: string; description?: string; plugins: Array<{ name: string; config?: Record<string, unknown> }> }) => {
      registered.push(definition)
      return async () => { removed += 1 }
    },
  })
  const stop = registerHerdrPreset(ctx, { info() {}, warn() {} })
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].id, HERDR_PRESET_ID)
  assert.equal(registered[0].name, HERDR_PRESET_NAME_ZH)
  assert.equal(registered[0].description, HERDR_PRESET_DESCRIPTION_ZH)
  assert.ok(HERDR_PRESET_NAME_EN.length > 0)
  assert.ok(HERDR_PRESET_DESCRIPTION_EN.length > 0)
  assert.ok(registered[0].plugins.some(plugin => plugin.name === '@namewta/dsh-plugin-herdr/session-mode'))
  const persona = registered[0].plugins.find(plugin => plugin.name === '@deepseek-ai/dsh-persona')
  assert.equal(typeof persona?.config?.prefix, 'string')
  assert.ok(String(persona?.config?.prefix).length > 0)
  stop()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(removed, 1)
})
