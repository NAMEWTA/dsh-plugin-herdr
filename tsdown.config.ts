import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/client-entry.ts', 'src/session-mode.ts'],
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  target: 'node24',
  clean: true,
  // package.json exports point at .js / .d.ts. Node platform otherwise emits .mjs.
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
