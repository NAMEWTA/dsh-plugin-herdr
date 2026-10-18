import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { isPathWithin, isPathWithinProject } from '../../src/core/paths.ts'

const id = (value: string) => value

test('filesystem root contains existing descendants through the production wrapper', () => {
  const descendant = os.tmpdir()
  assert.equal(isPathWithinProject(path.parse(descendant).root, descendant), true)
})

test('POSIX root contains descendants and itself, but not relative or empty paths', () => {
  const opts = { sep: '/', realpath: id }
  assert.equal(isPathWithin('/', '/home/project', opts), true)
  assert.equal(isPathWithin('/', '/', opts), true)
  assert.equal(isPathWithin('/', 'home/project', opts), false)
  assert.equal(isPathWithin('/', '', opts), false)
  assert.equal(isPathWithin('', '/home/project', opts), false)
})

test('Windows drive root contains descendants without crossing drives', () => {
  const opts = { sep: '\\', caseInsensitive: true, realpath: id }
  assert.equal(isPathWithin('C:\\', 'c:\\project', opts), true)
  assert.equal(isPathWithin('C:/', 'c:/project', opts), true)
  assert.equal(isPathWithin('C:\\', 'D:\\project', opts), false)
  assert.equal(isPathWithin('C:\\', 'C:project', opts), false)
})

test('ordinary project prefix boundaries and trailing separator are preserved', () => {
  const opts = { sep: '/', realpath: id }
  assert.equal(isPathWithin('/project', '/project/src', opts), true)
  assert.equal(isPathWithin('/project', '/project-other/src', opts), false)
  assert.equal(isPathWithin('/project/', '/project/src', opts), true)
  assert.equal(isPathWithin('/project/', '/project-other/src', opts), false)
})
