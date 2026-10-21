import { defineConfig } from 'vitest/config'
export default defineConfig({test:{environment:'jsdom',include:['tests/components/**/*.test.tsx'],setupFiles:['tests/components/setup.ts'],testTimeout:10000,restoreMocks:true}})
