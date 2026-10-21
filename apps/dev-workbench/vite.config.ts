import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),server:{host:'127.0.0.1',port:5173,strictPort:true},build:{target:'es2022',outDir:'dist',emptyOutDir:true},optimizeDeps:{exclude:['@workbench/core','@workbench/contracts','@workbench/herdr','@workbench/example-notes']}})
