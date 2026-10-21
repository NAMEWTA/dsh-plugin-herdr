import {readFile,access} from 'node:fs/promises'
const dir=new URL('../apps/dsh-plugin/',import.meta.url)
for(const path of ['lib/terminal.js','lib/sbom.cdx.json','lib/SHA256SUMS','lib/host.js','lib/client.js','lib/typert.host.js','lib/build.json','README.md','LICENSE','NOTICE','icon.svg'])await access(new URL(path,dir))
const pkg=JSON.parse(await readFile(new URL('package.json',dir),'utf8')),build=JSON.parse(await readFile(new URL('lib/build.json',dir),'utf8'))
if(pkg.version!==build.version)throw new Error('Stale build: run pnpm build')
