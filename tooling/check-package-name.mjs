// Metadata check only. A 404 is not a claim of trademark or publishing permission.
const name='@namewta/dsh-workbench'
const response=await fetch('https://registry.npmjs.org/'+encodeURIComponent(name),{signal:AbortSignal.timeout(15000)})
if(![200,404].includes(response.status))throw Error('Package-name verification failed: HTTP '+response.status)
console.log(JSON.stringify({name,checkedAt:new Date().toISOString(),registry:'https://registry.npmjs.org',status:response.status===404?'not-found':'already-registered',publicationAuthorized:false,note:'No publication attempted. Scope access, ownership and final product naming require maintainer approval.'},null,2))
