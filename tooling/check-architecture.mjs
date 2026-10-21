import ts from 'typescript'
import {readFile,readdir} from 'node:fs/promises'
import {resolve,relative,dirname,join} from 'node:path'
import postcss from 'postcss'
const root=resolve('.'),errors=[],files=[]
async function walk(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(['node_modules','lib','dist'].includes(item.name))continue;const path=join(dir,item.name);if(item.isDirectory())await walk(path);else if(/\.tsx?$/.test(item.name)&&!item.name.endsWith('.generated.ts'))files.push(path)}}
for(const dir of ['apps','adapters','modules','packages'])await walk(dir)
const owner=file=>file.split('/').slice(0,2).join('/')
const manifests=new Map()
for(const file of files){const base=owner(file);if(!manifests.has(base))manifests.set(base,JSON.parse(await readFile(join(base,'package.json'),'utf8')))}
const names=new Map([...manifests].map(([base,pkg])=>[pkg.name,base]))
const edges=new Map([...manifests.keys()].map(key=>[key,new Set()]))
for(const file of files){
  const source=await readFile(file,'utf8'),base=owner(file),pkg=manifests.get(base)
  if(/__reactFiber|__reactProps|MutationObserver|querySelector\([^)]*(?:sessionRow|regionArea)/.test(source))errors.push(file+': private host DOM access')
  const parsed=ts.preProcessFile(source,true,true)
  for(const item of parsed.importedFiles){const spec=item.fileName
    if(spec.startsWith('.')){const target=relative(root,resolve(dirname(file),spec)).replaceAll('\\','/');if(owner(target)!==base)errors.push(file+': cross-package relative import '+spec);continue}
    const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]
    if(names.has(name)){
      edges.get(base).add(names.get(name))
      if(!pkg.devDependencies?.[name]&&!pkg.dependencies?.[name]&&!pkg.peerDependencies?.[name])errors.push(file+': undeclared workspace dependency '+name)
      const exported='.'+spec.slice(name.length);if(!manifests.get(names.get(name)).exports?.[exported==='.'?'.':exported])errors.push(file+': private workspace import '+spec)
    }
    if((base.startsWith('packages/')||base.startsWith('modules/'))&&spec.startsWith('@deepseek-ai/'))errors.push(file+': host dependency outside adapter')
    if(['packages/platform-contracts','packages/module-sdk','packages/platform-core'].includes(base)&&(/react|@workbench\/(herdr|ui|shell|dsh)/.test(spec)))errors.push(file+': platform dependency inversion')
    if((file.includes('/src/web/')||base==='packages/ui'||base==='packages/workbench-shell')&&(spec.startsWith('node:')||spec.includes('/infrastructure/')||spec.includes('/application/')))errors.push(file+': browser reaches server implementation')
    if(file.includes('/src/web/')&&!file.includes('adapters/')&&/client.*dsh|@deepseek/.test(spec))errors.push(file+': module Web reaches host')
  }
}
const visiting=new Set(),done=new Set()
function visit(key){if(visiting.has(key)){errors.push('Package cycle: '+key);return}if(done.has(key))return;visiting.add(key);for(const dep of edges.get(key))visit(dep);visiting.delete(key);done.add(key)}
for(const key of edges.keys())visit(key)
const css=postcss.parse(await readFile('.evidence/workbench-scoped.css','utf8'))
css.walkRules(rule=>{if(rule.parent?.type==='atrule'&&/keyframes$/.test(rule.parent.name))return;for(const selector of rule.selectors)if(!selector.startsWith('.wb-root'))errors.push('Unscoped emitted CSS: '+selector)})
if(errors.length)throw Error(errors.join('\n'))
console.log('Architecture passed:',files.length,'source files, public exports, acyclic packages, host isolation, scoped CSS')
