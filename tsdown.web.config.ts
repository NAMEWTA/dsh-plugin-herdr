import { defineConfig } from 'tsdown'

// Web client bundle. React and Cordis come from the shell module table.
// The banner registers one lazy factory. The factory body must not import
// shell client packages; those stay on the host module table.
const MODULE_LOADER_ID = 'dsh-plugin-herdr'

export default defineConfig({
  entry: ['src/client.tsx'],
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  jsx: 'automatic',
  target: 'es2022',
  dts: false,
  clean: false,
  // The client export is lib/client.js. A type:module package otherwise emits .cjs.
  outExtensions: () => ({ js: '.js' }),
  banner: () => `window.__ModuleLoader__.load({
  id: "${MODULE_LOADER_ID}",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
`,
  footer: () => `
    return module.exports;
  }
});
`,
  external: [
    'react',
    'react/jsx-runtime',
    '@deepseek-ai/cordis',
  ],
  deps: {
    alwaysBundle: ['@xterm/xterm', '@xterm/addon-fit', 'zod'],
  },
})
