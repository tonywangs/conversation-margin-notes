import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&existsSync('/tmp/margin-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/tmp/margin-browsers';
const {chromium}=await import('playwright');
const live=process.argv.includes('--live');
const cases=live?[
  {provider:'ChatGPT',url:'https://chatgpt.com/share/8d523f18-86c8-44af-8002-a5bcf45ffbb5',needle:'I have filled out a JSON file'},
  {provider:'Gemini',url:'https://gemini.google.com/share/37ac58221046',needle:'Use as dicas'}
]:[{provider:'isolated privacy fixture',url:'https://privacy.example.test/conversation',needle:'A public passage for an annotation.'},{provider:'loopback privacy fixture',url:'http://127.0.0.1:8771/conversation',needle:'A public passage for an annotation.'}];
const scratch=await mkdtemp('/tmp/margin-secure-'),extension=path.join(root,'extension');
const results={date:new Date().toISOString(),mode:live?'live public pages':'synthetic privacy boundary',cases:[],complete:false};
let context,activeEditor;
try {
  context=await chromium.launchPersistentContext(path.join(scratch,'profile'),{channel:'chromium',headless:true,viewport:{width:1100,height:800},env:{...process.env,XDG_CONFIG_HOME:path.join(scratch,'config'),XDG_CACHE_HOME:path.join(scratch,'cache')},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--enable-unsafe-extension-debugging','--renderer-process-limit=2','--num-raster-threads=1']});
  context.setDefaultTimeout(20000);
  if(!live)await context.route(/^(https:\/\/privacy\.example\.test|http:\/\/127\.0\.0\.1:8771)\//,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><main><p>A public passage for an annotation.</p><p>A second public passage.</p></main></body></html>'}));
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  await worker.evaluate(async()=>{while(!chrome.action.onClicked.hasListeners())await new Promise(r=>setTimeout(r,10));});
  const id=worker.url().split('/')[2],cdp=await context.browser().newBrowserCDPSession();
  const tabs=async()=>(await cdp.send('Target.getTargets',{filter:[{type:'tab'}]})).targetInfos;
  results.browser=context.browser().version();
  const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
  assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert(!manifest.host_permissions&&!manifest.web_accessible_resources&&!manifest.externally_connectable);
  results.permissions=manifest.permissions;
  for(const item of cases){
    const outcome={provider:item.provider,url:item.url,checks:[]};results.cases.push(outcome);
    const check=name=>{outcome.checks.push(name);console.log(`PASS ${item.provider}: ${name}`);};
    const before=new Set((await tabs()).map(t=>t.targetId));const page=await context.newPage();
    const target=(await tabs()).find(t=>!before.has(t.targetId)).targetId;
    const reply=await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:45000});outcome.httpStatus=reply.status();
    await page.waitForFunction(needle=>document.querySelector('main')?.innerText.includes(needle),item.needle,{timeout:45000});
    if(live)await page.waitForTimeout(30000); // Allow real provider hydration before selecting.
    outcome.title=await page.title();check('real transcript rendered'+(live?'':' (fixture)'));
    await page.bringToFront();
    for(let i=0;i<100&&!(await tabs()).find(t=>t.targetId===target)?.embedderData?.tabActive;i++)await new Promise(r=>setTimeout(r,20));
    const created=context.waitForEvent('page');
    await cdp.send('Extensions.triggerAction',{id,targetId:target});const editor=await created;activeEditor=editor;
    await editor.waitForURL(`chrome-extension://${id}/secure.html?tab=*`);
    await editor.locator('#status').filter({hasText:'Ready.'}).waitFor();
    await page.evaluate(needle=>{const walk=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);let node;while(node=walk.nextNode()){if(node.textContent.includes(needle)){const range=document.createRange();const start=node.textContent.indexOf(needle);range.setStart(node,start);range.setEnd(node,Math.min(node.length,start+80));const s=getSelection();s.removeAllRanges();s.addRange(range);return;}}throw Error('Transcript text node missing');},item.needle);
    await editor.getByRole('button',{name:'Annotate selection',exact:true}).click();
    await editor.locator('#composer').waitFor({state:'visible'});
    const marker=`Private local note ${crypto.randomUUID()}`;
    const leaked=[];const inspect=request=>{if((request.url()+' '+(request.postData()||'')).includes(marker))leaked.push(request.url());};context.on('request',inspect);
    await editor.getByLabel('Your note',{exact:true}).fill(marker);
    await editor.locator('#persistence').filter({hasText:'Draft persisted on this device.'}).waitFor();
    assert.equal(await page.evaluate(value=>document.documentElement.outerHTML.includes(value),marker),false);
    assert.equal(await page.locator('#conversation-margin-notes-panel').count(),0);
    assert.equal(await page.evaluate(()=>typeof chrome.runtime?.sendMessage),'undefined');
    const denied=await worker.evaluate(async target=>{
      const [{result}]=await chrome.scripting.executeScript({target:{tabId:target},func:async()=>{
        try{return await chrome.runtime.sendMessage({type:'read'});}catch{return null;}
      }});return result;
    },Number(new URL(editor.url()).searchParams.get('tab')));
    assert(!denied?.ok,'source content scripts must not read the notebook');
    check('private draft lives in extension origin; no page UI or page messaging bridge');
    await editor.getByRole('button',{name:'Save note',exact:true}).click();await editor.locator('#status').filter({hasText:'Note saved'}).waitFor();
    const note=editor.locator('article').filter({hasText:marker});await note.waitFor();assert.match(await note.locator('.tag').innerText(),/^(exact|uniquely reanchored)$/);check('create and attach');
    await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(needle=>document.querySelector('main')?.innerText.includes(needle),item.needle,{timeout:45000});
    if(live)await page.waitForTimeout(30000);
    await editor.getByRole('button',{name:'Refresh source & notes',exact:true}).click();await editor.locator('#status').filter({hasText:'Ready.'}).waitFor();
    await note.waitFor();const reloadAnchor=await note.locator('.tag').innerText();outcome.reloadAnchor=reloadAnchor;
    if(reloadAnchor==='ambiguous'){
      const quotation=await note.locator('blockquote').innerText();
      const model=await editor.evaluate(async()=>{const target=Number(new URL(location.href).searchParams.get('tab'));return (await chrome.tabs.sendMessage(target,{type:'source',action:'snapshot'})).value;});
      const occurrences=model.text.split(quotation).length-1;assert(occurrences>1,'ambiguous label must correspond to repeated actual quotation');outcome.reloadOccurrences=occurrences;
      assert(await note.getByRole('button',{name:'Go to passage',exact:true}).isDisabled());
      check(`reload preserves note and correctly rejects ${occurrences} ambiguous matches`);
    }else{assert.match(reloadAnchor,/^(exact|uniquely reanchored)$/);check('reload and reattach');}
    await note.getByRole('button',{name:'Edit',exact:true}).click();await editor.getByLabel('Your note',{exact:true}).fill(marker+' edited');
    await editor.getByRole('button',{name:'Save note',exact:true}).click();await editor.locator('#status').filter({hasText:'Note updated'}).waitFor();check('edit');
    const pending=editor.waitForEvent('download');await editor.getByRole('button',{name:'Export all notes',exact:true}).click();const download=await pending;
    const data=JSON.parse(await readFile(await download.path(),'utf8'));const saved=data.notes.find(n=>n.body===marker+' edited');assert(saved);assert.equal(saved.source,item.url);assert(saved.selector.quote.includes(item.needle));check('export has edited body, real quotation and source');
    const stored=await worker.evaluate(()=>chrome.storage.local.get('notebook'));assert(stored.notebook.data.notes.some(n=>n.id===saved.id));
    assert.equal(await page.evaluate(value=>document.documentElement.outerHTML.includes(value),marker),false);assert.deepEqual(leaked,[]);check('local storage; no marker in source DOM or outgoing request URLs/bodies');
    if(!live){
      await page.evaluate(()=>{const root=document.querySelector('main');root.append(root.firstElementChild.cloneNode(true));});
      await note.locator('.tag').filter({hasText:'ambiguous'}).waitFor();assert.equal(await note.getByRole('button',{name:'Go to passage'}).isDisabled(),true);check('duplicate real DOM passage becomes ambiguous without attachment');
      await note.getByRole('button',{name:'Edit',exact:true}).click();
      await editor.getByLabel('Your note',{exact:true}).fill(marker+' recovery');
      await editor.locator('#persistence').filter({hasText:'Draft persisted on this device.'}).waitFor();
      // Opening another production editor exercises recovery and stale edits.
      const more=context.waitForEvent('page');await page.bringToFront();
      for(let i=0;i<100&&!(await tabs()).find(t=>t.targetId===target)?.embedderData?.tabActive;i++)await new Promise(r=>setTimeout(r,20));
      await cdp.send('Extensions.triggerAction',{id,targetId:target});const second=await more;
      await second.waitForURL(`chrome-extension://${id}/secure.html?tab=*`);await second.locator('#status').filter({hasText:'Ready.'}).waitFor();
      await second.locator('summary').click();await second.getByRole('button',{name:'Recover persisted draft',exact:true}).click();
      await second.locator('#composer').waitFor({state:'visible'});
      assert.equal(await second.getByLabel('Your note',{exact:true}).inputValue(),marker+' recovery');
      await second.getByLabel('Your note',{exact:true}).fill(marker+' winner');await second.getByRole('button',{name:'Save note',exact:true}).click();await second.locator('#status').filter({hasText:'Note updated'}).waitFor();
      await editor.getByRole('button',{name:'Save note',exact:true}).click();await editor.locator('#status').filter({hasText:/changed|discarded|conflict/i}).waitFor();
      assert.equal(await editor.getByLabel('Your note',{exact:true}).inputValue(),marker+' recovery');
      const after=await worker.evaluate(()=>chrome.storage.local.get('notebook'));assert.equal(after.notebook.data.notes.find(n=>n.id===saved.id).body,marker+' winner');
      check('persisted recovery and concurrent stale-save rejection preserve private draft');
      await second.close();
    }
    await editor.screenshot({path:path.join(root,'results',live?`live-${item.provider.toLowerCase()}.png`:'secure-editor.png')});
    context.off('request',inspect);await editor.close();await page.close();
  }
  results.complete=true;
} catch(error){results.error=error.message;results.editorStatus=await activeEditor?.locator('#status').textContent().catch(()=>null);console.error('Editor status:',results.editorStatus);throw error;}
finally{
  await context?.close();await rm(scratch,{recursive:true,force:true});
  await writeFile(path.join(root,'results',live?'live-verification.json':'secure-verification.json'),JSON.stringify(results,null,2)+'\n');
}
