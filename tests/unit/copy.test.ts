import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/** Brand names and technical tokens that stay Latin in Chinese copy. */
const ALLOW = new Set(['Herdr', 'DSH', 'Agent', 'Agents', 'JSON', 'ID', 'PID', 'CPU', 'RSS', 'CLI', 'Socket', 'POSIX', 'API', 'MiB', 'KiB', 'Node', 'WSL', 'TUI', 'HTTP', 'URL', 'Windows', 'Linux', 'English', 'protocol'])
const root = fileURLToPath(new URL('../..', import.meta.url))
const sources = [
  'packages/ui/src',
  'packages/workbench-shell/src',
  'modules/herdr/src/web',
  'modules/herdr/src/manifest.ts',
  'packages/platform-core/src/platform.ts',
  'adapters/dsh/src/web',
  'modules/example-notes/src',
  'adapters/dsh/src/host/tools.ts',
]
/** Tool descriptions and the approval `reason` string are model-facing single strings. The user-facing approval prompt is displayReason. */
const skipHardcoded = new Set(['adapters/dsh/src/host/tools.ts'])

function files(path: string): string[] {
  const absolute = join(root, path)
  if (!statSync(absolute).isDirectory()) return [path]
  return readdirSync(absolute).flatMap(name => {
    const child = join(path, name)
    if (name.endsWith('.d.ts') || name.includes('.generated.')) return []
    return statSync(join(root, child)).isDirectory() ? files(child) : child.endsWith('.ts') || child.endsWith('.tsx') ? [child] : []
  })
}
function unescapeString(body: string): string {
  return body.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, '\\')
}
function stripComments(source: string): string {
  let out = '', quote = '', i = 0
  while (i < source.length) {
    const c = source[i]!, next = source[i + 1]
    if (quote) {
      out += c
      if (c === '\\') { out += next ?? ''; i += 2; continue }
      if (c === quote) quote = ''
      i++; continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue }
    if (c === '/' && next === '/') { while (i < source.length && source[i] !== '\n') i++; continue }
    if (c === '/' && next === '*') { i += 2; while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++; i += 2; out += ' '; continue }
    out += c; i++
  }
  return out
}
function words(value: string): string[] { return value.replace(/\{[A-Za-z0-9]+\}/g, ' ').match(/[A-Za-z][A-Za-z0-9]*/g) ?? [] }
function cjk(value: string): boolean { return /\p{Script=Han}/u.test(value) }
function codeToken(value: string): boolean { return /^[a-z0-9_.:@/+-]+$/.test(value) }
function looksLikeCopy(zh: string, en: string): boolean {
  return cjk(zh) || cjk(en) || /\s/.test(zh) || /\s/.test(en) || zh === en || /[A-Z]/.test(zh + en)
}

interface Pair { file: string; key: string; zh: string; en: string }
function pairs(file: string, source: string): Pair[] {
  const found: Pair[] = []
  const tuple = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*(['"])((?:\\.|(?!\2).)*)\2\s*,\s*(['"])((?:\\.|(?!\4).)*)\4\s*\]/g
  for (const match of source.matchAll(tuple)) {
    const zh = unescapeString(match[3]!), en = unescapeString(match[5]!)
    if (looksLikeCopy(zh, en) && !(codeToken(zh) && codeToken(en))) found.push({ file, key: match[1]!, zh, en })
  }
  const localized = /\{\s*(zh|en)\s*:\s*(['"])((?:\\.|(?!\2).)*)\2\s*,\s*(zh|en)\s*:\s*(['"])((?:\\.|(?!\5).)*)\5\s*\}/g
  for (const match of source.matchAll(localized)) {
    const first = match[1]!, second = match[4]!
    if (first === second || (first !== 'zh' && first !== 'en') || (second !== 'zh' && second !== 'en')) continue
    const zh = unescapeString(first === 'zh' ? match[3]! : match[6]!)
    const en = unescapeString(first === 'en' ? match[3]! : match[6]!)
    found.push({ file, key: `${first}/${second}`, zh, en })
  }
  return found
}
function maskCopy(source: string): string {
  return source
    .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*(['"])(?:\\.|(?!\2).)*\2\s*,\s*(['"])(?:\\.|(?!\3).)*\3\s*\]/g, '""')
    .replace(/\{\s*(?:zh|en)\s*:\s*(['"])(?:\\.|(?!\1).)*\1\s*,\s*(?:zh|en)\s*:\s*(['"])(?:\\.|(?!\2).)*\2\s*\}/g, '""')
    .replace(/(?:locale|language|hostLocale)\s*===\s*['"]zh['"]\s*\?\s*(['"`])(?:\\.|(?!\1).)*\1\s*:\s*(['"`])(?:\\.|(?!\2).)*\2/g, '""')
    .replace(/new Error\(\s*(['"`])(?:\\.|(?!\1).)*\1\s*\)/g, '""')
}
function literals(source: string): string[] {
  const out: string[] = []
  for (const match of source.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
    if (match[1] === '`' && match[2]!.includes('${')) continue
    out.push(unescapeString(match[2]!))
  }
  return out
}
function hardcoded(value: string): boolean {
  if (value.includes('monospace') || value.includes('var(--') || value.startsWith('#')) return false
  if (/^[A-Z][A-Z0-9_]+$/.test(value)) return false
  const tokens = value.trim().split(/\s+/).filter(Boolean)
  const title = tokens.filter(token => /^[A-Z][a-z]{2,}$/.test(token) && !ALLOW.has(token))
  const shouting = tokens.filter(token => /^[A-Z]{3,}$/.test(token) && !ALLOW.has(token))
  const plain = tokens.filter(token => /^[a-z]{3,}$/.test(token) && !ALLOW.has(token))
  return title.length > 0 || shouting.length > 1 || plain.length > 1
}

const catalog = sources.flatMap(path => files(path).map(file => ({ file, source: readFileSync(join(root, file), 'utf8') })))

test('Chinese and English copy stay paired, and Chinese does not keep untranslated status words', () => {
  const found = catalog.flatMap(item => pairs(item.file, stripComments(item.source)))
  assert.ok(found.length >= 80, `expected the message catalogs, found ${found.length}`)
  const problems: string[] = []
  for (const pair of found) {
    if (!pair.zh.trim() || !pair.en.trim()) problems.push(`${pair.file} ${pair.key}: empty side`)
    const extra = words(pair.zh).filter(word => !ALLOW.has(word))
    if (extra.length) problems.push(`${pair.file} ${pair.key}: Chinese still contains ${extra.join(', ')}`)
    if (!cjk(pair.zh) && extra.length === 0 && words(pair.zh).length === 0) problems.push(`${pair.file} ${pair.key}: Chinese side has no text`)
    if (!cjk(pair.zh) && words(pair.zh).some(word => !ALLOW.has(word))) problems.push(`${pair.file} ${pair.key}: Chinese is not translated`)
    if (!/[A-Za-z]/.test(pair.en) && !cjk(pair.en)) problems.push(`${pair.file} ${pair.key}: English side is empty of letters`)
  }
  assert.deepEqual(problems, [])
})

test('user-visible literals are not hardcoded English outside the message catalogs', () => {
  const problems: string[] = []
  for (const item of catalog) {
    if (skipHardcoded.has(item.file)) continue
    const masked = maskCopy(stripComments(item.source))
    for (const literal of literals(masked)) {
      if (hardcoded(literal)) problems.push(`${item.file}: ${JSON.stringify(literal)}`)
    }
  }
  assert.deepEqual(problems, [])
})
