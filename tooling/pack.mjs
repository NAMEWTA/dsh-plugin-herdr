// Absolute paths avoid pnpm --filter resolving pack-destination from the caller.
import {execFileSync} from 'node:child_process'
import {mkdir,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {checkPackage} from './check-package.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const directory=join(root,'apps/dsh-plugin'),destination=join(root,'artifacts')
const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
await mkdir(destination,{recursive:true})
// prepack only checks lib/. A clean checkout has no sbom until this build writes it.
execFileSync('pnpm',['build'],{cwd:root,stdio:'inherit'})
execFileSync('pnpm',['--dir',directory,'pack','--pack-destination',destination],{cwd:root,stdio:'inherit'})
const name=pkg.name.replace(/^@/,'').replaceAll('/','-')+'-'+pkg.version+'.tgz'
await checkPackage(join(destination,name))
