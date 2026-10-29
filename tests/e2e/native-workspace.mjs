import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {FIXTURE_PROMPT,FIXTURE_REPLY} from './local-model.mjs'

// Selectors come from the public pinned DSH 0.2.1-rc.2 workspace/directory/conversation UI.
// No host React state, private classes, Remote calls or synthetic session logs are used.
export async function exerciseNativeWorkspace(page,{home,out,model,record}){
  const directory=join(home,'native-workspace-acceptance')
  await mkdir(directory,{recursive:true,mode:0o700})
  const add=page.getByRole('button',{name:'Add workspace',exact:true})
  const picker=page.getByRole('dialog',{name:'Select Workspace Directory',exact:true})
  await add.click();await picker.waitFor()
  await picker.getByRole('button',{name:'Cancel',exact:true}).click();await picker.waitFor({state:'hidden'})
  await add.click();await picker.waitFor()
  await picker.getByRole('button',{name:'Edit path',exact:true}).click()
  const pathInput=picker.getByRole('textbox',{name:'Edit path',exact:true})
  await pathInput.fill(directory);await pathInput.press('Enter');await pathInput.waitFor({state:'hidden'})
  await picker.getByRole('button',{name:'Open',exact:true}).click();await picker.waitFor({state:'hidden'})
  const conversation=page.locator('[data-conversation-content][data-conversation-session]')
  await conversation.waitFor({timeout:30000})
  await conversation.getByRole('button',{name:'Choose workspace',exact:true}).getByText('native-workspace-acceptance',{exact:true}).waitFor({timeout:30000})
  const sessionId=await conversation.getAttribute('data-conversation-session');assert.ok(sessionId)
  await record('native DSH directory picker cancel/reopen, folder selection and real session creation')
  await page.screenshot({path:join(out,'native-workspace.png'),fullPage:true})
  const input=conversation.getByRole('textbox',{name:'Describe what you want to build, / commands, @ files or sessions',exact:true})
  await input.fill(FIXTURE_PROMPT)
  await conversation.getByRole('button',{name:'Send message',exact:true}).click()
  await page.getByText(FIXTURE_REPLY,{exact:true}).first().waitFor({timeout:30000})
  assert.ok(model.requests.some(request=>request.acceptancePrompt),'Real host must call the local Messages fixture')
  await page.getByRole('tab',{name:'Workbench',exact:true}).click()
  await page.locator('.wb-binding-card').getByText('Bound · native-workspace-acceptance',{exact:true}).waitFor({timeout:30000})
  const before=await page.locator('.wb-page').getByRole('heading',{level:1,name:'native-workspace-acceptance',exact:true}).textContent()
  assert.equal(before,'native-workspace-acceptance')
  await page.screenshot({path:join(out,'native-conversation-binding.png'),fullPage:true})
  await page.reload({waitUntil:'domcontentloaded'})
  await page.locator('[data-conversation-content][data-conversation-session]').waitFor({timeout:30000})
  assert.equal(await page.locator('[data-conversation-content]').getAttribute('data-conversation-session'),sessionId)
  await page.getByRole('tab',{name:'Workbench',exact:true}).click()
  await page.locator('.wb-binding-card').getByText('Bound · native-workspace-acceptance',{exact:true}).waitFor({timeout:30000})
  await record('actual DSH conversation through localhost Messages fixture, automatic project-path binding and reload persistence (not external-model acceptance)')
  await writeFile(join(out,'native-conversation.json'),JSON.stringify({nativeWorkspaceSelected:true,sessionCreated:true,localFixtureTurn:true,bindingPersisted:true,externalModelTested:false,fixtureRequests:model.requests.length},null,2))
  // Return through the existing public global slot to preserve the rest of acceptance.
  await page.locator('[data-workbench-entry]').first().locator('xpath=ancestor::*[self::button or @role="button" or @role="tab"][1]').click()
  await page.getByRole('heading',{name:'Your agent workspace',exact:true}).waitFor({timeout:30000})
}
