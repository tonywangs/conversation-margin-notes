import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function draftBrowserSuite({launch,origin,panel,select,create,refresh,stored,download,upload}) {
 const checks=[],latency=[],nativeLatency=[],metrics={};
 const check=text=>{checks.push(text);console.log('PASS '+text);};
 let app=await launch('draft-restart'),p=await app.context.newPage();
 async function diagnostics(){return app.worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===url);return (await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>globalThis.marginPanel.diagnostics()}))[0].result;},p.url());}
 const status=pattern=>panel(p).locator('#status').filter({hasText:pattern}).waitFor();
 const persisted=page=>panel(page).locator('#persistence').filter({hasText:/^Draft persisted/}).waitFor();
 const drafts=()=>app.worker.evaluate(async()=>(await chrome.storage.local.get('drafts')).drafts);
 const waitIdle=page=>page.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);
 const click=async id=>{await panel(p).locator('#'+id).click();};
 async function recoveryDownload(button) {const pending=p.waitForEvent('download');await button.click();return JSON.parse(await readFile(await (await pending).path(),'utf8'));}
 async function persistText(text) {const start=performance.now();await panel(p).locator('#body').fill(text);await persisted(p);latency.push(performance.now()-start);nativeLatency.push((await diagnostics()).drafts);}
 await p.goto(origin+'/conversation.html');await app.activate(p);
 await select(p,'unique');const hostile='<script>window.__draftOwned=1</script> 🌙 & <img src=x onerror=alert(1)>';
 await persistText(hostile);const original=(await drafts()).entries[0];
 assert.equal(original.body,hostile);assert.equal(await stored(app.worker),undefined);
 assert.equal(await panel(p).locator('img,script').count(),0);assert.equal(await p.evaluate(()=>window.__draftOwned),undefined);
 assert.equal(await panel(p).locator('#persistence').getAttribute('aria-live'),'polite');
 await p.reload();await app.activate(p);assert(await panel(p).locator('#composer').isHidden());
 assert.equal(await panel(p).locator('[data-draft-id]').count(),1);
 await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).focus();
 const focus=await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).evaluate(el=>({width:getComputedStyle(el).outlineWidth,style:getComputedStyle(el).outlineStyle}));
 assert.equal(focus.style,'solid');assert.equal(focus.width,'3px');
 await p.keyboard.press('Enter');await status(/Draft recovered/);assert.equal(await panel(p).locator('#body').inputValue(),hostile);
 await persistText(hostile+' after reload');
 metrics.beforeRestartStorageBytes=await app.worker.evaluate(()=>chrome.storage.local.getBytesInUse(null));
 metrics.browser=app.context.browser().version();const oldWorker=app.worker.url();await app.context.close();
 // A new launchPersistentContext starts a fresh Chromium process with the same
 // on-disk profile. No storage data is copied or supplied by the test.
 app=await launch('draft-restart');assert.equal(app.worker.url(),oldWorker);
 p=await app.context.newPage();await p.goto(origin+'/second.html');await app.activate(p);
 assert.equal(await panel(p).locator('[data-draft-id]').count(),1);assert(await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).isDisabled());
 assert.equal(await panel(p).locator('article').count(),0);
 const exportedRecovery=await recoveryDownload(panel(p).getByRole('button',{name:'Export recovery',exact:true}));
 assert.equal(exportedRecovery.format,'margin-notes-draft-recovery');assert.equal(exportedRecovery.draft.body,hostile+' after reload');assert.equal(exportedRecovery.draft.note.source,origin+'/conversation.html');
 await p.goto(origin+'/conversation.html');await app.activate(p);await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await status(/Draft recovered/);
 assert.equal(await panel(p).locator('#body').inputValue(),hostile+' after reload');
 await p.screenshot({path:new URL('../results/draft-recovery.png',import.meta.url).pathname});
 await p.setViewportSize({width:320,height:740});assert(await panel(p).evaluate(el=>{const box=el.shadowRoot.querySelector('.panel');return box.scrollWidth<=box.clientWidth;}));
 await p.screenshot({path:new URL('../results/draft-narrow.png',import.meta.url).pathname});await p.setViewportSize({width:1280,height:900});
 await click('save');await status(/Note saved/);assert.equal((await stored(app.worker)).data.notes.length,1);assert.equal((await drafts()).entries.length,0);
 const portable=await download(p);assert.equal(JSON.parse(portable).notes[0].body,hostile+' after reload');
 check('Native storage → reload → fresh browser-process restart → source-locked keyboard recovery → save → portable export');

 // A delayed native acknowledgment cannot label later input as persisted.
 await select(p,'ending');await click('persist');await persisted(p);
 await app.worker.evaluate(()=>{globalThis.draftNativeSet=chrome.storage.local.set.bind(chrome.storage.local);globalThis.draftEntered=false;chrome.storage.local.set=async value=>{if(value.drafts){globalThis.draftEntered=true;await new Promise(r=>{globalThis.draftRelease=r;});}return draftNativeSet(value);};});
 await panel(p).locator('#body').fill('first delayed snapshot');await click('persist');
 async function waitWorker(fn) {const start=Date.now();while(!await app.worker.evaluate(fn)){if(Date.now()-start>10000)throw new Error('Worker boundary timeout');await new Promise(r=>setTimeout(r,10));}}
 await waitWorker(()=>globalThis.draftEntered);
 await panel(p).locator('#body').fill('later text must not be acknowledged by first reply');
 assert.match(await panel(p).locator('#persistence').textContent(),/^Pending edits/);
 await app.worker.evaluate(()=>{chrome.storage.local.set=globalThis.draftNativeSet;globalThis.draftRelease();});
 await persisted(p);assert.equal((await drafts()).entries[0].body,'later text must not be acknowledged by first reply');
 await click('cancel');await status(/Draft discarded/);assert.equal((await drafts()).entries.length,0);
 check('Delayed native draft acknowledgment coalesces newer input; explicit discard waits for the writer');

 // Explicit cancellation during an in-flight write must not resurrect a draft.
 await select(p,'ending');await persisted(p);
 await app.worker.evaluate(()=>{globalThis.draftEntered=false;chrome.storage.local.set=async value=>{if(value.drafts){globalThis.draftEntered=true;await new Promise(r=>{globalThis.draftRelease=r;});}return draftNativeSet(value);};});
 await panel(p).locator('#body').fill('discard while native write is pending');await click('persist');await waitWorker(()=>globalThis.draftEntered);
 await click('cancel');assert(await panel(p).locator('#cancel').isDisabled());assert(await panel(p).locator('#composer').isVisible());
 await app.worker.evaluate(()=>{chrome.storage.local.set=globalThis.draftNativeSet;globalThis.draftRelease();});
 await status(/Draft discarded/);assert.equal((await drafts()).entries.length,0);
 await p.reload();await app.activate(p);assert.equal(await panel(p).locator('[data-draft-id]').count(),0);
 check('Discard during an in-flight native write waits for its acknowledgment and cannot resurrect on reload');

 // Persistence may finish after navigation, but still belongs to the old source.
 await select(p,'ending');await persisted(p);
 await app.worker.evaluate(()=>{globalThis.draftEntered=false;chrome.storage.local.set=async value=>{if(value.drafts){globalThis.draftEntered=true;await new Promise(r=>{globalThis.draftRelease=r;});}return draftNativeSet(value);};});
 await panel(p).locator('#body').fill('original-source delayed persistence');await click('persist');await waitWorker(()=>globalThis.draftEntered);
 await p.evaluate(()=>history.pushState({},'',location.pathname+'?other-conversation'));
 assert(await panel(p).locator('#save').isDisabled());
 await app.worker.evaluate(()=>{chrome.storage.local.set=globalThis.draftNativeSet;globalThis.draftRelease();});await persisted(p);
 assert.equal((await drafts()).entries[0].note.source,origin+'/conversation.html');assert(await panel(p).locator('#save').isDisabled());
 await p.goto(origin+'/conversation.html');await app.activate(p);await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await status(/Draft recovered/);assert.equal(await panel(p).locator('#body').inputValue(),'original-source delayed persistence');
 await click('cancel');await status(/Draft discarded/);
 check('Navigation during native persistence retains original identity and requires explicit recovery after reload');

 // Two tabs recover the same persisted version. A stale writer must retain text.
 await select(p,'ending');await persistText('Shared recovery snapshot');await p.reload();await app.activate(p);
 const q=await app.context.newPage();await q.goto(origin+'/conversation.html');await app.activate(q);
 await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await status(/Draft recovered/);
 await panel(q).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await panel(q).locator('#status').filter({hasText:/Draft recovered/}).waitFor();
 await persistText('Winning tab draft');await panel(q).locator('#body').fill('Losing tab text remains exportable');await panel(q).locator('#persist').click();
 await panel(q).locator('#persistence').filter({hasText:/changed or was discarded/}).waitFor();
 assert.equal((await drafts()).entries[0].body,'Winning tab draft');assert.equal(await panel(q).locator('#body').inputValue(),'Losing tab text remains exportable');
 const pending=q.waitForEvent('download');await panel(q).locator('#export-draft').click();const qExport=JSON.parse(await readFile(await (await pending).path(),'utf8'));assert.equal(qExport.draft.body,'Losing tab text remains exportable');
 await panel(q).locator('#cancel').click();await panel(q).locator('#status').filter({hasText:/Discard failed/}).waitFor();assert.equal((await drafts()).entries[0].body,'Winning tab draft');
 await q.close();await click('cancel');await status(/Draft discarded/);
 check('Concurrent recovery uses draft versions; losing edits export, stale discard cannot delete winning text');

 // Edit base revision is immutable even after refresh/reload; deletion is conflict.
 const row=panel(p).locator('article').first();await row.getByRole('button',{name:'Edit',exact:true}).click();await persistText('Old edit must never overwrite a newer note');
 const r=await app.context.newPage();await r.goto(origin+'/conversation.html');await app.activate(r);
 await panel(r).locator('article').first().getByRole('button',{name:'Edit',exact:true}).click();await panel(r).locator('#body').fill('Newer committed note');await panel(r).locator('#save').click();await panel(r).locator('#status').filter({hasText:/Note updated/}).waitFor();
 const newer=await stored(app.worker);await refresh(p);assert(await panel(p).locator('#save').isDisabled());
 await p.reload();await app.activate(p);await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await status(/conflict/);assert(await panel(p).locator('#save').isDisabled());assert.deepEqual(await stored(app.worker),newer);
 await click('separate');await status(/Separate draft persisted/);await click('save');await status(/Note saved/);
 const separate=await stored(app.worker);assert.equal(separate.data.notes.length,2);assert(separate.data.notes.some(n=>n.body==='Newer committed note'));assert(separate.data.notes.some(n=>n.body==='Old edit must never overwrite a newer note'));
 await click('refresh-drafts');await panel(p).getByRole('button',{name:'Discard persisted draft',exact:true}).click();await status(/Persisted draft discarded/);
 await refresh(p);await panel(p).locator('article').first().getByRole('button',{name:'Edit',exact:true}).click();await persistText('Deleted note recovery');
 const target=(await drafts()).entries[0].note.id;await refresh(r);const rRow=panel(r).locator(`article[data-note-id="${target}"]`);await rRow.getByRole('button',{name:'Delete',exact:true}).click();await rRow.getByRole('button',{name:'Confirm delete',exact:true}).click();await panel(r).locator('#status').filter({hasText:/Note deleted/}).waitFor();
 await p.reload();await app.activate(p);await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await status(/conflict/);assert(await panel(p).locator('#save').isDisabled());assert(!(await stored(app.worker)).data.notes.some(n=>n.id===target));await click('cancel');await status(/Draft discarded/);await r.close();
 check('Refresh and restart cannot rebase stale edits; separate-note recovery preserves newer notes; deleted notes stay deleted');

 // Actual quota exhaustion must keep both notebook and acknowledged draft intact.
 await refresh(p);await select(p,'ending');await persistText('acknowledged before quota');const before=await stored(app.worker),beforeDrafts=await drafts();
 await app.worker.evaluate(async()=>{const used=await chrome.storage.local.getBytesInUse(null);await chrome.storage.local.set({draftQuotaFiller:'x'.repeat(chrome.storage.local.QUOTA_BYTES-used-100)});});
 await panel(p).locator('#body').fill('recoverable pending quota text '.repeat(150));await click('persist');await panel(p).locator('#persistence').filter({hasText:/persistence failed/}).waitFor();
 assert.deepEqual(await stored(app.worker),before);assert.deepEqual(await drafts(),beforeDrafts);assert.match(await panel(p).locator('#body').inputValue(),/recoverable pending/);
 const failedExport=await recoveryDownload(panel(p).locator('#export-draft'));assert.match(failedExport.draft.body,/recoverable pending/);
 await app.worker.evaluate(()=>chrome.storage.local.remove('draftQuotaFiller'));await click('persist');await persisted(p);await click('cancel');await status(/Draft discarded/);
 check('Real local-storage quota exhaustion preserves saved notes and last acknowledged draft; pending text exports and retries');

 // Read failure cannot turn a stale recovery listing into a new composer.
 await select(p,'ending');await persistText('read failure recovery');await p.reload();await app.activate(p);
 await app.worker.evaluate(()=>{globalThis.draftNativeGet=chrome.storage.local.get.bind(chrome.storage.local);chrome.storage.local.get=async()=>{throw new Error('Injected recovery read failure');};});
 await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await status(/Injected recovery read failure/);assert(await panel(p).locator('#composer').isHidden());
 await app.worker.evaluate(()=>{chrome.storage.local.get=globalThis.draftNativeGet;});await refresh(p);await panel(p).getByRole('button',{name:'Discard persisted draft',exact:true}).click();await status(/Persisted draft discarded/);
 check('Failed recovery read leaves the composer closed and stored draft intact');

 // A successful note write plus failed cleanup is deliberately recoverable.
 await select(p,'ending');await persistText('Saved note with retained cleanup copy');
 const beforeCleanup=await stored(app.worker);
 await app.worker.evaluate(()=>{chrome.storage.local.set=async value=>{if(value.drafts)throw new Error('Injected cleanup failure');return draftNativeSet(value);};});
 await click('save');await status(/draft cleanup failed/);
 assert.equal((await stored(app.worker)).data.notes.length,beforeCleanup.data.notes.length+1);assert.equal((await drafts()).entries.length,1);
 await app.worker.evaluate(()=>{chrome.storage.local.set=globalThis.draftNativeSet;});
 await panel(p).getByRole('button',{name:'Recover persisted draft',exact:true}).click();await status(/already saved note/);assert(await panel(p).locator('#save').isDisabled());
 await click('recover');await status(/Draft recovered/);assert(await panel(p).locator('#save').isEnabled());
 await click('cancel');await status(/Draft discarded/);await panel(p).getByRole('button',{name:'Discard persisted draft',exact:true}).click();await status(/Persisted draft discarded/);
 assert.equal((await stored(app.worker)).data.notes.length,beforeCleanup.data.notes.length+1);
 check('Failed post-save cleanup retains a recovery copy and identifies already-saved content without duplication');

 const beforeCapacity=await stored(app.worker);
 // Capacity bound through native storage/UI, with no implicit expiry or eviction.
 await app.worker.evaluate(async source=>{
   const note={id:crypto.randomUUID(),source,body:'',created:'2020-01-01T00:00:00.000Z',updated:'2020-01-01T00:00:00.000Z',selector:{quote:'fixture',prefix:'',suffix:'',start:0,end:7,fingerprint:'a'.repeat(64)}};
   const entries=Array.from({length:32},(_,i)=>({id:crypto.randomUUID(),version:1,note:{...note,id:crypto.randomUUID()},baseRevision:0,baseNote:null,body:`Old retained draft ${i}`}));
   await chrome.storage.local.set({drafts:{version:1,entries}});
 },origin+'/second.html');
 await refresh(p);assert.equal(await panel(p).locator('[data-draft-id]').count(),32);const full=await drafts();
 await select(p,'ending');await panel(p).locator('#body').fill('thirty-third draft retained in editor');await click('persist');await panel(p).locator('#persistence').filter({hasText:/32 drafts/}).waitFor();assert.deepEqual(await drafts(),full);assert.deepEqual(await stored(app.worker),beforeCapacity);
 await click('cancel');await status(/Draft discarded/);assert.deepEqual(await drafts(),full);
 metrics.capacityStorageBytes=await app.worker.evaluate(()=>chrome.storage.local.getBytesInUse('drafts'));
 assert(metrics.capacityStorageBytes<1048576);await p.setViewportSize({width:320,height:740});
 assert(await panel(p).evaluate(el=>{const box=el.shadowRoot.querySelector('.panel');return box.scrollWidth<=box.clientWidth;}));
 check('32-draft bound rejects extra persistence without eviction; old drafts remain listed and usable at 320px');
 const notebook=await download(p);metrics.finalStorageBytes=await app.worker.evaluate(()=>chrome.storage.local.getBytesInUse(null));
 await app.context.close();
 const imported=await launch('draft-portable-import'),dest=await imported.context.newPage();await dest.goto(origin+'/conversation.html');await imported.activate(dest);await upload(dest,notebook);await panel(dest).locator('#status').filter({hasText:/Imported/}).waitFor();assert.equal(await download(dest),notebook);await imported.context.close();
 check('Recovered saved notes retain the existing portable notebook format in a fresh profile');
 return {checks,latency_ms:latency,writer_samples:nativeLatency,metrics,limitations:['Synthetic bundled pages; no live provider or human screen-reader testing.','Latency includes debounce, IPC, native storage and Playwright scheduling.','Fresh-process restart is graceful; hardware crash durability is not tested.']};
}
