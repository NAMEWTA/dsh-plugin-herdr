import { afterEach, expect, test } from 'vitest'
import { bindWorkbenchStyles, installWorkbenchStyles, mountWorkbenchStyles, releaseWorkbenchStyles, WORKBENCH_STYLE_ID } from '@workbench/ui'

afterEach(() => { releaseWorkbenchStyles() })

test('the workbench sheet is installed in document.head and in the mount shadow root, once', () => {
  const css = '.wb-root{color:red}'
  const release = bindWorkbenchStyles(node => installWorkbenchStyles(css, node))
  const host = document.createElement('div')
  const shadow = host.attachShadow({mode: 'open'})
  const node = document.createElement('div')
  shadow.append(node)
  document.body.append(host)
  try {
    mountWorkbenchStyles(node)
    mountWorkbenchStyles(node)
    const head = document.head.querySelectorAll(`#${WORKBENCH_STYLE_ID}`)
    const inner = shadow.querySelectorAll(`#${WORKBENCH_STYLE_ID}`)
    expect(head).toHaveLength(1)
    expect(inner).toHaveLength(1)
    expect(head[0]?.textContent).toBe(css)
    expect(inner[0]?.textContent).toBe(css)
    expect(head[0]?.getAttribute('data-plugin')).toBe('@namewta/dsh-workbench')
    expect(head[0]?.getAttribute('data-plugin-css')).toBe('@namewta/dsh-workbench/workbench.css')
    expect(document.querySelectorAll(`#${WORKBENCH_STYLE_ID}`)).toHaveLength(1)
  } finally {
    release()
    host.remove()
  }
})
