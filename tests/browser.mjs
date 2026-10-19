import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,rm,writeFile,cp,rename,copyFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {draftBrowserSuite} from './drafts-browser.mjs';
import {mutationSuite} from './mutations.mjs';
import {dynamicSuite} from './dynamic.mjs';
import {navigationSuite,navigationImport} from './navigation.mjs';
const root=path.resolve(import.meta.dirname,'..');
if(!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/tmp/margin-browsers'))process.env.PLAYWRIGHT_BROWSERS_PATH='/tmp/margin-browsers';
const {chromium}=await import('playwright');
export async function browserSuite({navigationOnly=false,draftsOnly=false}={}) {
  const start=performance.now(),scratch=await mkdtemp(path.join(tmpdir(),'margin-verify-'));
  // Historical in-page UI regression suite, using an explicit test-only worker.
  // Production action/privacy behavior is exercised by secure-browser.mjs.
  const legacyExtension=path.join(scratch,'legacy-extension');
  await cp(path.join(root,'extension'),legacyExtension,{recursive:true});
  await rename(path.join(legacyExtension,'worker.js'),path.join(legacyExtension,'production-worker.js'));
  await copyFile(path.join(root,'tests','legacy-worker.js'),path.join(legacyExtension,'worker.js'));
  await copyFile(path.join(root,'tests','legacy-panel.js'),path.join(legacyExtension,'panel.js'));
  const checks=[],contexts=[],errors=[],network={pageBlocked:0,proxyBlocked:0};
  async function deadline(work,label,ms=15000) {let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]);}finally{clearTimeout(timer);}}
  const check=description=>{checks.push(description);console.log('PASS '+description);};
  const server=createServer(async(req,res)=>{
    const file=new URL(req.url,'http://localhost').pathname;
    if(!['/conversation.html','/second.html','/blank.html','/dynamic.html','/dynamic.js','/navigation.html','/navigation.js'].includes(file)){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
    res.end(file==='/blank.html'?'<!doctype html><html><body><main>blank</main></body></html>':await readFile(path.join(root,'fixtures',file.slice(1))));
  });
  const proxy=createServer((_req,res)=>{network.proxyBlocked++;res.writeHead(403);res.end('External networking disabled by verification harness.');});
  proxy.on('connect',(_req,socket)=>{socket.on('error',()=>{});network.proxyBlocked++;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const env={...process.env,XDG_CONFIG_HOME:path.join(scratch,'config'),XDG_CACHE_HOME:path.join(scratch,'cache')};
  await mkdir(env.XDG_CONFIG_HOME);await mkdir(env.XDG_CACHE_HOME);
  async function launch(name) {
    const extension=legacyExtension;
    const context=await chromium.launchPersistentContext(path.join(scratch,name),{channel:'chromium',headless:true,timeout:30000,viewport:{width:1280,height:900},env,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--enable-unsafe-extension-debugging','--renderer-process-limit=2','--num-raster-threads=1',`--proxy-server=http://127.0.0.1:${proxy.address().port}`,'--proxy-bypass-list=127.0.0.1','--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
    contexts.push(context);
    await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin || ['chrome-extension:','data:','blob:'].includes(url.protocol))return route.continue();network.pageBlocked++;return route.abort('blockedbyclient');});
    context.setDefaultTimeout(10000);
    const nativeNewPage=context.newPage.bind(context),tabTargets=new WeakMap();
    context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
    const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
    const nativeEvaluate=worker.evaluate.bind(worker);worker.evaluate=(...args)=>deadline(nativeEvaluate(...args),'Worker evaluation');
    const browserCDP=await deadline(context.browser().newBrowserCDPSession(),'Browser CDP session');
    const tabs=async()=> (await browserCDP.send('Target.getTargets',{filter:[{type:'tab'}]})).targetInfos;
    // Page creation is serial in this harness. Capture the new tab's identity
    // before navigation: URLs and titles are not unique across concurrent tabs.
    context.newPage=(...args)=>deadline((async()=>{
      const before=new Set((await tabs()).map(t=>t.targetId));
      const page=await nativeNewPage(...args);
      const added=(await tabs()).filter(t=>!before.has(t.targetId));
      assert.equal(added.length,1,'page creation must identify exactly one new tab');
      tabTargets.set(page,added[0].targetId);
      return page;
    })(),'New browser page');
    async function activate(page) {
      // A serviceworker event announces creation, not completion of its script.
      // Wait for the real action listener before issuing the experimental CDP action.
      await worker.evaluate(async()=>{
        const started=Date.now();
        while(!chrome.action.onClicked.hasListeners()) {
          if(Date.now()-started>10000)throw new Error('Extension action listener did not initialize.');
          await new Promise(resolve=>setTimeout(resolve,10));
        }
      });
      await page.bringToFront();
      const targetId=tabTargets.get(page);assert(targetId,'page has a captured tab target');
      // triggerAction invokes the window's toolbar action. Wait for tab selection
      // as well as targeting the right window; do not retry the action itself.
      await deadline((async()=>{
        while(!(await tabs()).find(t=>t.targetId===targetId)?.embedderData?.tabActive)
          await new Promise(resolve=>setTimeout(resolve,10));
      })(),'Intended extension tab activation');
      await browserCDP.send('Extensions.triggerAction',{id:worker.url().split('/')[2],targetId});
      try {await page.locator('#conversation-margin-notes-panel').waitFor();} catch(error) {
        const diagnostic=await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({});return Promise.all(tabs.map(async tab=>({url:tab.url,title:await chrome.action.getTitle({tabId:tab.id})})));});
        throw new Error(`${error.message} Action diagnostics: ${JSON.stringify(diagnostic)}`);
      }
      await page.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);
    }
    return {context,worker,activate,browserCDP};
  }
  const panel=p=>p.locator('#conversation-margin-notes-panel');
  const item=p=>panel(p).locator('article');
  const status=p=>panel(p).locator('#status');
  async function message(p,pattern) {try{await panel(p).locator('#status, #anchors').filter({hasText:pattern}).first().waitFor({timeout:10000});}catch(e){throw new Error(`${e.message} Panel: ${await panel(p).locator('#status, #persistence').allTextContents()}`);}}
  async function select(p,id,start=0,end=null) {
    await p.evaluate(({id,start,end})=>{const n=document.getElementById(id).firstChild;const r=document.createRange();r.setStart(n,start);r.setEnd(n,end??n.length);const s=getSelection();s.removeAllRanges();s.addRange(r);},{id,start,end});
    await panel(p).getByRole('button',{name:'Annotate selection',exact:true}).click();
    await panel(p).locator('#composer').waitFor({state:'visible'});
  }
  async function create(p,id,text) {await select(p,id);await panel(p).getByLabel('Your note',{exact:true}).fill(text);await panel(p).getByRole('button',{name:'Save note',exact:true}).click();await message(p,/Note saved/);}
  async function refresh(p) {await panel(p).getByRole('button',{name:'Refresh notes & anchors',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);}
  async function download(p) {const pending=p.waitForEvent('download');await panel(p).getByRole('button',{name:'Export all notes',exact:true}).click();const d=await pending;return readFile(await d.path(),'utf8');}
  async function upload(p,text) {await panel(p).locator('#file').setInputFiles({name:'notes.json',mimeType:'application/json',buffer:Buffer.from(text)});}
  async function stored(worker) {return worker.evaluate(async()=> (await chrome.storage.local.get('notebook')).notebook);}
  try {
    if(draftsOnly)return await draftBrowserSuite({launch,origin,panel,select,create,refresh,stored,download,upload});
    const first=await launch('first');const {context,worker,activate}=first;const p=await context.newPage();
    await p.goto(origin+'/conversation.html');assert.equal(await panel(p).count(),0);assert.equal(await stored(worker),undefined);
    const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());assert.deepEqual(manifest.permissions,['activeTab','scripting','storage']);assert(!manifest.host_permissions && !manifest.content_scripts);check('No page injection or storage before explicit activation; minimal permissions');
    const external=await p.evaluate(async()=>{try{await fetch('https://example.com/');return true;}catch{return false;}});assert.equal(external,false);
    const workerExternal=await worker.evaluate(async()=>{try{await fetch('https://example.com/');return true;}catch{return false;}});assert.equal(workerExternal,false);check('External page and worker HTTP(S) blocked');
    if(navigationOnly) {await p.close();const page=await context.newPage(),browser=context.browser().version();const navigation=await navigationSuite({page,worker,activate,create,refresh,stored,origin,download,upload});await context.close();await navigationImport({launch,origin,upload,download,exported:navigation.exported});delete navigation.exported;return {browser,navigation};}
    const twin=await context.newPage();await twin.goto(p.url());
    assert.equal(await panel(twin).count(),0);
    await activate(p);await message(p,/Ready/);
    assert.equal(await panel(twin).count(),0,'same-URL background tab must remain uninjected');
    await activate(twin);await message(twin,/Ready/);
    assert.equal(await panel(p).count(),1);await twin.close();
    check('Same-URL tabs activate independently using captured tab identities and confirmed tab selection');
    await create(p,'unique','Check this on a cloudy night.');assert.equal(await item(p).count(),1);assert.equal(await item(p).locator('.tag').textContent(),'exact');
    let original=await stored(worker);assert.equal(original.data.notes[0].selector.quote,'Start with a notebook, a clear sky, and one careful observation.');check('Real extension action → selection → persisted note with selector');
    await item(p).getByRole('button',{name:'Edit',exact:true}).click();await panel(p).getByLabel('Your note',{exact:true}).fill('Edited: keep the uncertain results.');await panel(p).getByRole('button',{name:'Save note',exact:true}).click();await message(p,/Note updated/);assert.equal((await stored(worker)).data.notes[0].body,'Edited: keep the uncertain results.');
    await p.reload();assert.equal(await panel(p).count(),0);await activate(p);assert.equal(await item(p).count(),1);assert.match(await item(p).textContent(),/Edited:/);check('Edit, reload, explicit reactivation, persistence');
    await item(p).getByRole('button',{name:'Go to passage',exact:true}).focus();await p.keyboard.press('Enter');await message(p,/Passage selected/);assert.equal(await p.evaluate(()=>getSelection().toString()),original.data.notes[0].selector.quote);assert.equal(await p.evaluate(()=>CSS.highlights.get('margin-notes-active').size),1);check('Keyboard passage navigation and CSS highlight');
    const hostile='<img src=x onerror=alert(1)> & <script>window.__owned=1</script>';
    await create(p,'hostile',hostile);assert.equal(await panel(p).locator('img,script').count(),0);assert.equal(await p.evaluate(()=>window.__owned),undefined);check('Hostile quote and note rendered as text');
    await create(p,'unicode','Unicode survives 🌙 café café 日本語 👩‍👩‍👧‍👦');
    await create(p,'code','Code preserves its normalized anchor.');
    await create(p,'repeat-one','Repeated quote: never guess after edits.');check('Unicode, code blocks and repeated quotations');
    const exported=await download(p);assert.equal(exported,await download(p));assert.equal(JSON.parse(exported).notes.length,5);check('Deterministic downloaded JSON export');
    // Real quota failure, not a substitute storage implementation.
    const beforeQuota=await stored(worker);
    await worker.evaluate(async()=>{const used=await chrome.storage.local.getBytesInUse(null);await chrome.storage.local.set({quotaFiller:'x'.repeat(chrome.storage.local.QUOTA_BYTES-used-100)});});
    await select(p,'ending');await panel(p).getByLabel('Your note',{exact:true}).fill('Draft must survive quota failure. '.repeat(30));await panel(p).getByRole('button',{name:'Save note',exact:true}).click();await message(p,/Save failed/);
    assert.deepEqual(await stored(worker),beforeQuota);assert.match(await panel(p).getByLabel('Your note',{exact:true}).inputValue(),/Draft must survive/);await worker.evaluate(()=>chrome.storage.local.remove('quotaFiller'));await panel(p).getByRole('button',{name:'Cancel draft',exact:true}).click();check('Actual chrome.storage.local quota failure preserves notes and draft');
    // Fail the native storage boundary to test delete/import failures as well.
    await worker.evaluate(()=>{globalThis.savedSet=chrome.storage.local.set;chrome.storage.local.set=async()=>{throw new Error('Injected storage write failure');};});
    await item(p).first().getByRole('button',{name:'Delete',exact:true}).click();await item(p).first().getByRole('button',{name:'Confirm delete',exact:true}).click();await message(p,/Injected storage write failure/);assert.deepEqual(await stored(worker),beforeQuota);
    const extra=structuredClone(JSON.parse(exported));extra.notes=extra.notes.slice(0,1);extra.notes[0].id='99999999-9999-4999-8999-999999999999';await upload(p,JSON.stringify(extra));await message(p,/Injected storage write failure/);assert.deepEqual(await stored(worker),beforeQuota);
    await worker.evaluate(()=>{chrome.storage.local.set=globalThis.savedSet;delete globalThis.savedSet;});check('Injected delete/import storage failures preserve existing notebook');
    // Whole-import validation, including file bound before reading.
    for(const bad of ['{','{"version":2,"notes":[]}',JSON.stringify({...JSON.parse(exported),unexpected:true})]){await upload(p,bad);await message(p,/Import failed/);assert.deepEqual(await stored(worker),beforeQuota);}
    await upload(p,' '.repeat(2097153));await message(p,/exceeds 2 MiB/);assert.deepEqual(await stored(worker),beforeQuota);
    const conflict=JSON.parse(exported);conflict.notes[0].body='conflict';await upload(p,JSON.stringify(conflict));await message(p,/Conflicting note ID/);assert.deepEqual(await stored(worker),beforeQuota);check('Malformed, oversized and conflicting imports fail atomically');
    // Source changes invalidate all ranges, then recover conservatively.
    await p.evaluate(()=>{const h=document.createElement('p');h.textContent='An inserted preamble.';document.querySelector('main').prepend(h);});await message(p,/Page changed/);assert.equal(await p.evaluate(()=>CSS.highlights.has('margin-notes')),false);
    await refresh(p);const repeated=item(p).filter({hasText:'Repeated quote: never guess'});assert.equal(await repeated.locator('.tag').textContent(),'ambiguous');assert(await repeated.getByRole('button',{name:'Go to passage'}).isDisabled());
    const unique=item(p).filter({hasText:'Edited: keep'});assert.equal(await unique.locator('.tag').textContent(),'uniquely reanchored');
    await p.evaluate(()=>document.querySelector('#unique').remove());await refresh(p);assert.equal(await unique.locator('.tag').textContent(),'missing');assert(await unique.getByRole('button',{name:'Go to passage'}).isDisabled());check('DOM invalidation, unique recovery, repeated ambiguity and missing passages');
    // Root replacement and oversized pages must fail closed without trapping backups.
    await p.evaluate(()=>document.querySelector('main').remove());await message(p,/Page changed/);await refresh(p);await message(p,/Unsupported page/);assert.equal(await download(p),exported);
    await p.evaluate(()=>{const main=document.createElement('main');main.textContent='x'.repeat(200001);document.body.append(main);});await refresh(p);await message(p,/200,000/);assert.equal(await download(p),exported);
    await p.reload();await activate(p);await select(p,'ending');await panel(p).getByLabel('Your note',{exact:true}).fill('x'.repeat(4001));assert(await panel(p).getByRole('button',{name:'Save note',exact:true}).isDisabled());await panel(p).getByRole('button',{name:'Cancel draft',exact:true}).click();
    // A CSS-only visibility change does not emit a root mutation. Capture must reindex.
    await p.evaluate(()=>{const style=document.createElement('style');style.id='cssom-test';document.head.append(style);});
    await p.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='ready');
    await p.evaluate(()=>document.querySelector('#cssom-test').sheet.insertRule('#unique { visibility:hidden }'));
    await p.evaluate(()=>{const n=document.querySelector('#ending').firstChild,r=document.createRange();r.selectNodeContents(n);getSelection().removeAllRanges();getSelection().addRange(r);});await panel(p).getByRole('button',{name:'Annotate selection',exact:true}).click();await message(p,/Page changed|Refresh anchors/);assert(await panel(p).locator('#composer').isHidden());assert.equal(await download(p),exported);
    await p.reload();await activate(p);check('Root removal, document limit, body limit and CSS-only stale selection; export remains available');
    await p.setViewportSize({width:320,height:640});const bounds=await panel(p).boundingBox();assert(bounds.x>=0 && bounds.width<=320);
    const overflow=await panel(p).locator('.panel').evaluate(el=>el.scrollWidth>el.clientWidth);assert.equal(overflow,false);
    await panel(p).getByRole('button',{name:'Close notes panel'}).focus();await p.keyboard.press('Escape');assert.equal(await panel(p).isVisible(),false);await activate(p);assert(await panel(p).isVisible());
    await p.screenshot({path:path.join(root,'results','narrow.png')});check('320px viewport, keyboard Escape, reopen, no panel horizontal overflow');
    // Seeded DOM mutation experiment uses production DOM + anchor code, with its own construction oracle.
    const experiment=await context.newPage();await experiment.goto(origin+'/blank.html');await experiment.addScriptTag({path:path.join(root,'extension/core.js')});await experiment.addScriptTag({path:path.join(root,'extension/dom.js')});const mutations=await mutationSuite(experiment);check('280 seeded DOM mutations and ten negative DOM cases');
    await p.setViewportSize({width:1280,height:900});await p.reload();await activate(p);await p.screenshot({path:path.join(root,'results','desktop.png')});
    const browserVersion=context.browser().version(),fixtureElements=await p.locator('main *').count();
    const navigationPage=await context.newPage();
    const navigation=await navigationSuite({page:navigationPage,worker,activate,create,refresh,stored,origin,download,upload,launch});check('Navigation identity, 256 seeded sequences, delayed storage, draft recovery, reload and export');
    await navigationPage.close();
    const dynamicPage=await context.newPage();
    const dynamic=await dynamicSuite({page:dynamicPage,worker,activate,create,refresh,stored,origin});check('256 installed-extension mutation sequences; independent intermediate and final anchor oracle; draft, focus, caret and selection preservation');
    const demo=await context.newPage();await demo.setViewportSize({width:1800,height:1000});await demo.goto(origin+'/dynamic.html');await activate(demo);await create(demo,'target','Synthetic demo note.');
    await demo.getByRole('button',{name:'Duplicate passage',exact:true}).click();
    await panel(demo).locator('.tag').filter({hasText:'ambiguous'}).waitFor();
    await demo.getByRole('button',{name:'Restore original',exact:true}).click();
    await panel(demo).locator('.tag').filter({hasText:'exact'}).waitFor();
    await demo.getByRole('button',{name:'Toggle incomplete',exact:true}).click();
    await panel(demo).locator('.tag').filter({hasText:'incomplete'}).waitFor();
    await demo.getByRole('button',{name:'Toggle incomplete',exact:true}).click();
    await panel(demo).locator('.tag').filter({hasText:'exact'}).waitFor();check('Bundled dynamic example controls recover ambiguous, exact and incomplete states');
    await context.close();
    await navigationImport({launch,origin,upload,download,exported:navigation.exported});delete navigation.exported;
    navigation.checks.push('Fresh-profile import and same-tab navigation preserve identity and exported bytes');
    check('Fresh-profile navigation import preserves both conversation identities and exact exported bytes');
    // Fresh profile restores actual downloaded bytes, without copying browser storage.
    const second=await launch('fresh');const p2=await second.context.newPage();await p2.goto(origin+'/conversation.html');await second.activate(p2);assert.equal(await item(p2).count(),0);await upload(p2,exported);await message(p2,/Imported 5/);assert.equal(await item(p2).count(),5);assert.equal(await download(p2),exported);
    await upload(p2,exported);await message(p2,/skipped 5/);assert.equal(await item(p2).count(),5);check('Fresh-profile import and identical duplicate skipping');
    await p2.goto(origin+'/second.html');await second.activate(p2);assert.equal(await item(p2).count(),0);await panel(p2).getByLabel('Show notes',{exact:true}).selectOption('all');assert.equal(await item(p2).count(),5);for(const tag of await item(p2).locator('.tag').allTextContents())assert.equal(tag,'source mismatch');check('Source mismatch diagnostics, no cross-source attachment');
    // Multi-tab optimistic concurrency: two genuine panels share one worker queue.
    await p2.goto(origin+'/conversation.html?tab=second');await second.activate(p2);await create(p2,'unique','Tab two');
    const p3=await second.context.newPage();await p3.goto(origin+'/conversation.html?tab=third');await second.activate(p3);await select(p2,'ending');await panel(p2).getByLabel('Your note',{exact:true}).fill('Retained concurrent draft');
    await create(p3,'opening','Concurrent committed note');const concurrent=await stored(second.worker);await panel(p2).getByRole('button',{name:'Save note',exact:true}).click();await message(p2,/another tab/);assert.deepEqual(await stored(second.worker),concurrent);assert.equal(await panel(p2).getByLabel('Your note',{exact:true}).inputValue(),'Retained concurrent draft');await refresh(p2);assert(await panel(p2).locator('#save').isDisabled());await panel(p2).locator('#separate').click();await message(p2,/Separate draft persisted/);await panel(p2).getByRole('button',{name:'Save note',exact:true}).click();await message(p2,/Note saved/);check('Concurrent tab conflict retains draft; refresh cannot bypass base revision; explicit separate note succeeds');
    // Exercise a full notebook through real import and bounded UI pagination.
    await p2.goto(origin+'/conversation.html');await second.activate(p2);let current=await stored(second.worker);const base=JSON.parse(exported).notes[0];const many={version:1,notes:[]};
    for(let i=0;i<500-current.data.notes.length;i++)many.notes.push({...base,id:`11111111-1111-4111-8111-${String(i).padStart(12,'0')}`,body:`Capacity note ${i}`});
    await upload(p2,JSON.stringify(many));await message(p2,/Imported/);await panel(p2).getByLabel('Show notes',{exact:true}).selectOption('all');assert.equal((await stored(second.worker)).data.notes.length,500);
    const fullUpdateStarted=performance.now();
    await p2.evaluate(()=>document.querySelector('main').lastElementChild.append(' Full notebook update.'));
    await p2.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='ready');
    const fullNotebookUpdateMs=performance.now()-fullUpdateStarted;
    const reached=new Set();let maxRows=0,maxDOM=0,maxHighlights=0;
    for(let i=0;i<25;i++) {
      const ids=await item(p2).evaluateAll(items=>items.map(el=>el.dataset.noteId));ids.forEach(id=>reached.add(id));maxRows=Math.max(maxRows,ids.length);
      maxDOM=Math.max(maxDOM,await panel(p2).locator('*').count());maxHighlights=Math.max(maxHighlights,await p2.evaluate(()=>CSS.highlights.get('margin-notes')?.size||0));
      if(i<24)await panel(p2).getByRole('button',{name:'Next',exact:true}).click();
    }
    assert.equal(reached.size,500);assert.equal(maxRows,20);assert(maxHighlights<=20);const fullState=await stored(second.worker);
    await select(p2,'ending');await panel(p2).getByLabel('Your note',{exact:true}).fill('One too many');await panel(p2).getByRole('button',{name:'Save note',exact:true}).click();await message(p2,/500 notes/);assert.deepEqual(await stored(second.worker),fullState);await panel(p2).getByRole('button',{name:'Cancel draft',exact:true}).click();check('500 notes reachable across 25 pages; 20 mounted rows/highlights; capacity rejection');
    // Delete persists, with explicit confirmation and keyboard activation.
    await panel(p2).getByLabel('Show notes',{exact:true}).selectOption('current');
    const deleteTarget=item(p2).first();const deletedID=await deleteTarget.getAttribute('data-note-id');await deleteTarget.getByRole('button',{name:'Delete',exact:true}).click();await deleteTarget.getByRole('button',{name:'Confirm delete',exact:true}).focus();await p2.keyboard.press('Enter');await message(p2,/Note deleted/);assert(!(await stored(second.worker)).data.notes.some(n=>n.id===deletedID));check('Confirmed keyboard deletion persists');
    await second.context.close();
    const drafts=await draftBrowserSuite({launch,origin,panel,select,create,refresh,stored,download,upload});
    assert.deepEqual(errors,[],'no uncaught page errors');
    return {browser:browserVersion,runtime_ms:Math.round(performance.now()-start),checks,network,dom:{maxMountedRows:maxRows,maxPanelElements:maxDOM,maxHighlights,reachableNotes:reached.size,fixtureElements,fullNotebookUpdateMs},mutations,dynamic,navigation,drafts};
  } finally {for(const c of contexts)await c.close();await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>proxy.close(resolve));await rm(scratch,{recursive:true,force:true});}
}
