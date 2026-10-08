import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/host/index.ts', 'session-mode': 'src/host/session-mode.ts' },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  target: 'node24',
  clean: true,
  // package.json exports point at .js / .d.ts. Node platform otherwise emits .mjs.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
