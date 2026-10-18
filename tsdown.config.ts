import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'environment-contract': 'src/host/environment/schema.ts',
    index: 'src/host/index.ts',
    'session-mode': 'src/host/session-mode.ts',
    'panel-contract': 'src/contracts/panel-schemas.ts',
  },
  outDir: 'lib',
  format: ['esm'],
  dts: true,
  target: 'node24',
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
})
