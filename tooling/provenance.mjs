import {readFile,writeFile,readdir,access} from 'node:fs/promises'
import {dirname,join,isAbsolute} from 'node:path'
import {createHash} from 'node:crypto'
export async function writeProvenance(out,moduleIds,manifest){
  const packages=new Map()
  for(const id of moduleIds){
    if(!isAbsolute(id)||!id.includes('/node_modules/'))continue
    let directory=dirname(id.split('?')[0])
    for(let i=0;i<12;i++){
      try{
        const info=JSON.parse(await readFile(join(directory,'package.json'),'utf8'))
        if(info.name&&info.version){packages.set(info.name+'@'+info.version,{directory,info});break}
      }catch{}
      const parent=dirname(directory);if(parent===directory)break;directory=parent
    }
  }
  const components=[],licenses=[]
  for(const [id,{directory,info}]of [...packages].sort(([a],[b])=>a.localeCompare(b))){
    const files=(await readdir(directory)).filter(file=>/^(licen[cs]e|copying|notice)([.-]|$)/i.test(file))
    const texts=[]
    for(const file of files){try{texts.push(await readFile(join(directory,file),'utf8'))}catch{}}
    if(!texts.length)throw new Error('Missing redistributed license text: '+id)
    licenses.push('='.repeat(72)+'\n'+id+'\n'+texts.join('\n'))
    components.push({type:'library',name:info.name,version:info.version,purl:'pkg:npm/'+info.name.split('/').map(encodeURIComponent).join('/')+'@'+info.version,licenses:[{license:{name:typeof info.license==='string'?info.license:info.license?.type??'SEE LICENSE'}}]})
  }
  const sbom={bomFormat:'CycloneDX',specVersion:'1.6',version:1,metadata:{component:{type:'application',name:manifest.name,version:manifest.version},properties:[{name:'workbench:scope',value:'Production modules actually traversed by the bundler; host-provided externals are declared as peerDependencies.'}]},components}
  await writeFile(join(out,'sbom.cdx.json'),JSON.stringify(sbom,null,2)+'\n')
  await writeFile(join(out,'THIRD-PARTY-LICENSES.txt'),licenses.join('\n\n'))
  const receipts=[]
  for(const file of (await readdir(out)).filter(f=>f!=='SHA256SUMS').sort()){
    const data=await readFile(join(out,file));receipts.push(createHash('sha256').update(data).digest('hex')+'  '+file)
  }
  await writeFile(join(out,'SHA256SUMS'),receipts.join('\n')+'\n')
  console.log('Bundled dependency licenses:',components.length)
}
