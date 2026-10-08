// zh/en copy parity: same keys and placeholders, no untranslated values, and no
// hardcoded user-facing copy in the web sources (QA found '刷新 Dashboard' and
// 'Best effort' style mixes). Product names (Herdr/herdr, DeepSeek Harness) and
// established technical terms (PID, CPU, Socket) are allowed in Chinese copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readJson = (name: string) => JSON.parse(readFileSync(join(root, 'locale', name), 'utf8')) as Record<string, unknown>

function flatten(value: Record<string, unknown>, prefix = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, item] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (item !== null && typeof item === 'object') for (const [k, v] of flatten(item as Record<string, unknown>, path)) out.set(k, v)
    else out.set(path, String(item))
  }
  return out
}

const zh = flatten(readJson('zh.json'))
const en = flatten(readJson('en.json'))
const CJK = /[\u3400-\u9fff\uff00-\uffef\u3000-\u303f]/
/** Latin tokens allowed inside Chinese copy. */
const ZH_LATIN_ALLOW = new Set(['Herdr', 'herdr', 'DeepSeek', 'Harness', 'PID', 'CPU', 'Socket', 'socket'])
/** Words that must never appear untranslated in Chinese copy. */
const ZH_DENY = ['Dashboard', 'Best effort', 'Refresh', 'Agent', 'agent', 'workspace', 'pane', 'Workspace', 'Pane', 'Loading', 'Error', 'failed']
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
const latinWords = (text: string) => text.replace(/\{\w+\}/g, '').match(/[A-Za-z][A-Za-z0-9+.-]*/g) ?? []

test('zh and en dictionaries have identical keys', () => {
  assert.deepEqual([...zh.keys()].sort(), [...en.keys()].sort())
})

test('zh and en values use the same placeholders', () => {
  for (const [key, value] of zh) assert.deepEqual(placeholders(value), placeholders(en.get(key) ?? ''), key)
})

test('zh values contain no untranslated English', () => {
  for (const [key, value] of zh) {
    const prose = value.replace(/\{\w+\}/g, '')
    for (const word of ZH_DENY) assert.ok(!prose.includes(word), `zh ${key} contains "${word}": ${value}`)
    for (const word of latinWords(value)) assert.ok(ZH_LATIN_ALLOW.has(word), `zh ${key} contains untranslated "${word}": ${value}`)
  }
})

test('en values contain no Chinese', () => {
  for (const [key, value] of en) assert.ok(!CJK.test(value), `en ${key} contains Chinese: ${value}`)
})

test('zh and en values differ unless the copy is only allowed terms', () => {
  for (const [key, value] of zh) {
    if (value !== en.get(key)) continue
    assert.ok(latinWords(value).every(word => ZH_LATIN_ALLOW.has(word)), `zh ${key} is identical to en: ${value}`)
  }
})

// --- web sources: user-facing copy must go through t() / locale files ---------

/** Literal strings in src/web that may legitimately contain Chinese (DSH DOM selectors). */
const CJK_LITERAL_ALLOW = new Set(['[aria-label="新建会话"]'])
/** Literal user-facing Latin text allowed in JSX / a11y attributes. */
const LATIN_UI_ALLOW = new Set(['Herdr', 'herdr', 'curl -fsSL https://herdr.dev/install.sh | sh'])
const UI_ATTRS = new Set(['title', 'aria-label', 'placeholder', 'alt'])

function scanWeb(): string[] {
  const problems: string[] = []
  const dir = join(root, 'src', 'web')
  for (const file of readdirSync(dir).filter(name => /\.tsx?$/.test(name) && !name.endsWith('.d.ts'))) {
    const source = readFileSync(join(dir, file), 'utf8')
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node: ts.Node): void => {
      let text: string | null = null
      let jsx = false
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text
      else if (ts.isJsxText(node)) { text = node.text.trim(); jsx = true }
      if (text) {
        const where = `${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`
        // styles.ts is CSS: only comments may carry Chinese.
        const checked = file === 'styles.ts' ? text.replace(/\/\*[\s\S]*?\*\//g, '') : text
        if (CJK.test(checked) && !CJK_LITERAL_ALLOW.has(text)) problems.push(`${where} hardcoded Chinese ${JSON.stringify(text.slice(0, 60))}`)
        const attr = ts.isJsxAttribute(node.parent) ? node.parent.name.getText() : null
        if ((jsx || (attr && UI_ATTRS.has(attr))) && /[A-Za-z]{2,}/.test(text) && !LATIN_UI_ALLOW.has(text)) problems.push(`${where} hardcoded English ${JSON.stringify(text.slice(0, 60))}`)
        // Template copy rendered next to t() output, e.g. ` · ${n} agent`.
        if (file.endsWith('.tsx') && !jsx && !attr && ts.isTemplateTail(node) && /\b[a-z]{3,}\b/.test(text) && /^\s/.test(text)) problems.push(`${where} English in template copy ${JSON.stringify(text.slice(0, 60))}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return problems
}

test('web sources have no hardcoded user-facing copy outside the locale files', () => {
  assert.deepEqual(scanWeb(), [])
})

test('terminal session errors are localized by code, not shown as host text', async () => {
  const { localizeTerminalError, TerminalRequestError } = await import('../../src/web/terminal-session.ts')
  const { setHerdrLang } = await import('../../src/web/i18n.ts')
  try {
    setHerdrLang('en')
    assert.equal(localizeTerminalError('terminal_session_unavailable', '达到全局进程数上限'), 'Terminal session unavailable')
    assert.equal(localizeTerminalError('terminal_session_not_found', 'session 不存在'), 'Terminal session not found or closed')
    assert.equal(localizeTerminalError(undefined, undefined), 'Terminal request failed')
    assert.equal(localizeTerminalError('unknown_code', 'raw detail'), 'raw detail')
    const error = new TerminalRequestError('terminal_session_unavailable', '达到全局 controller 上限')
    assert.equal(error.code, 'terminal_session_unavailable')
    assert.ok(!CJK.test(error.message))
    setHerdrLang('zh')
    assert.equal(localizeTerminalError('terminal_session_unavailable', 'terminal session unavailable'), '终端会话暂不可用')
  } finally {
    setHerdrLang('zh')
  }
})
