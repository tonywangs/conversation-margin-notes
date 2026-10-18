import assert from 'node:assert/strict';

export async function navigationEdges({page,worker,panel,ready,refresh,stored,urlA,urlB,waitWorker,isolated}) {
  const results=[];
  async function select() {
    await page.evaluate(()=>{const node=document.querySelector('#target').firstChild,range=document.createRange();range.selectNodeContents(node);getSelection().removeAllRanges();getSelection().addRange(range);});
    await panel.locator('#add').click();
  }
  async function noAttachment() {
    assert.equal(await page.evaluate(()=>CSS.highlights.has('margin-notes')||CSS.highlights.has('margin-notes-active')),false);
    assert.equal(await panel.locator('article').count(),0);assert(await panel.locator('#save').isDisabled());
  }
  async function delayWrite(fail=false) {
    await worker.evaluate(fail=>{globalThis.edgeSet=chrome.storage.local.set.bind(chrome.storage.local);globalThis.edgeWrite=false;chrome.storage.local.set=async(...args)=>{if(!args[0].notebook)return edgeSet(...args);globalThis.edgeWrite=true;await new Promise(r=>setTimeout(r,250));if(fail)throw new Error('Delayed navigation write failure');return edgeSet(...args);};},fail);
  }
  async function restoreWrite() {await worker.evaluate(()=>{chrome.storage.local.set=globalThis.edgeSet;delete globalThis.edgeSet;});}
  await page.locator('#a').click();await ready();await refresh(page);
  const original=await stored(worker);
  await select();await panel.locator('#body').fill('New draft stays in A 🌌');
  await page.locator('#b').click();await ready();assert(await panel.locator('#save').isDisabled());
  assert.equal(await panel.locator('#body').inputValue(),'New draft stays in A 🌌');
  await page.locator('#a').click();await ready();await panel.locator('#recover').click();
  await delayWrite();await panel.locator('#save').click();await waitWorker(()=>globalThis.edgeWrite);
  await page.locator('#b').click();await ready();await restoreWrite();
  await page.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);
  let state=await stored(worker),created=state.data.notes.filter(n=>n.body==='New draft stays in A 🌌');
  assert.equal(created.length,1);assert.equal(created[0].source,urlA);
  await page.locator('#a').click();await ready();await panel.locator('#recover').click();
  await panel.locator('#save').click();await panel.locator('#status').filter({hasText:'Note updated'}).waitFor();
  state=await stored(worker);assert.equal(state.data.notes.filter(n=>n.body==='New draft stays in A 🌌').length,1);
  const row=panel.locator(`article[data-note-id="${created[0].id}"]`);
  await row.getByRole('button',{name:'Delete',exact:true}).click();await row.getByRole('button',{name:'Confirm delete',exact:true}).click();
  await panel.locator('#status').filter({hasText:'Note deleted'}).waitFor();
  assert.deepEqual((await stored(worker)).data,original.data);
  await refresh(page);
  results.push('Unsaved create survives departure; delayed create recovers by stable UUID without duplication');

  await panel.getByRole('button',{name:'Edit',exact:true}).click();await panel.locator('#body').fill('Failed write draft retained');
  const beforeFailure=await stored(worker);
  await delayWrite(true);await panel.locator('#save').click();await waitWorker(()=>globalThis.edgeWrite);
  await page.locator('#b').click();await ready();await restoreWrite();
  await page.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);
  assert.deepEqual(await stored(worker),beforeFailure);assert.equal(await panel.locator('#body').inputValue(),'Failed write draft retained');
  assert(await panel.locator('#save').isDisabled());await panel.locator('#cancel').click();
  assert.deepEqual(await stored(worker),beforeFailure);
  await refresh(page);
  results.push('Delayed rejected write and explicit cancellation retain stored notebook bytes');

  // A read failure cannot silently turn a suspended draft into a writable one.
  await page.locator('#a').click();await ready();await panel.getByRole('button',{name:'Edit',exact:true}).click();
  await panel.locator('#body').fill('Read failure recovery draft');await page.locator('#b').click();await ready();await page.locator('#a').click();await ready();
  await worker.evaluate(()=>{globalThis.edgeGet=chrome.storage.local.get.bind(chrome.storage.local);chrome.storage.local.get=async()=>{throw new Error('Navigation read failure');};});
  await panel.locator('#recover').click();await panel.locator('#status').filter({hasText:'Navigation read failure'}).waitFor();
  assert(await panel.locator('#save').isDisabled());assert.equal(await panel.locator('#body').inputValue(),'Read failure recovery draft');
  await worker.evaluate(()=>{chrome.storage.local.get=globalThis.edgeGet;delete globalThis.edgeGet;});
  await refresh(page);await panel.locator('#recover').click();
  await panel.locator('#status').filter({hasText:'Draft recovered on its original source'}).waitFor();
  assert.equal(await panel.locator('#save').isDisabled(),false);
  await panel.locator('#cancel').click();assert.deepEqual(await stored(worker),beforeFailure);
  await refresh(page);
  results.push('Storage-read failure prevents draft recovery; explicit retry succeeds without writes');

  await refresh(page);await isolated('delay');
  try {await select();await page.locator('#b').click();await ready();assert(await panel.locator('#composer').isHidden());}
  finally {await isolated('restore');}
  await refresh(page);
  results.push('Capture fingerprint crossing navigation cannot open a draft on the destination');

  await page.locator('#a').click();await ready();await refresh(page);
  await panel.getByRole('button',{name:'Edit',exact:true}).click();await panel.locator('#body').fill('Queued edit must be rejected');
  await worker.evaluate(()=>{
    globalThis.queuedGet=chrome.storage.local.get.bind(chrome.storage.local);globalThis.queuedRead=false;
    chrome.storage.local.get=async(...args)=>{const value=await queuedGet(...args);globalThis.queuedRead=true;await new Promise(r=>{globalThis.queuedRelease=r;});return value;};
  });
  await panel.locator('#save').click();await waitWorker(()=>globalThis.queuedRead);
  await page.locator('#b').click();
  await worker.evaluate(()=>{chrome.storage.local.get=globalThis.queuedGet;globalThis.queuedRelease();delete globalThis.queuedGet;delete globalThis.queuedRelease;});
  await ready();await page.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);
  assert.deepEqual(await stored(worker),beforeFailure);assert.equal(await panel.locator('#body').inputValue(),'Queued edit must be rejected');
  await panel.locator('#cancel').click();await refresh(page);
  results.push('Worker rejects a queued edit after its sending tab URL changes');

  await isolated('delay-file');
  await panel.locator('#file').setInputFiles({name:'delayed.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(beforeFailure.data))});
  const fileStart=Date.now();while(!await isolated('file-started')){if(Date.now()-fileStart>5000)throw new Error('File hook timeout');await new Promise(r=>setTimeout(r,5));}
  await page.locator('#a').click();await ready();await isolated('release-file');
  await panel.locator('#status').filter({hasText:'Page changed while reading import'}).waitFor();
  assert.deepEqual(await stored(worker),beforeFailure);assert.equal((await isolated('diagnostics')).async.cancelledImports,1);
  await page.locator('#b').click();await ready();await refresh(page);
  results.push('File read crossing page sessions is cancelled before import dispatch');

  // Both forged entry events and DOM strings are untrusted. A bad marker cannot
  // authorize manual confirmation or cause quote matching to override identity.
  await page.evaluate(()=>{navigation.dispatchEvent(new Event('currententrychange'));document.querySelector('main').dataset.marginNotesSource='javascript:alert(1)';});
  await page.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='unresolved');
  await noAttachment();assert(await panel.locator('#confirm-source').isHidden());
  assert.equal(await page.evaluate(()=>window.__owned),undefined);
  await page.evaluate(url=>document.querySelector('main').dataset.marginNotesSource=url,urlB);await ready();
  assert.equal((await stored(worker)).data.notes.length,beforeFailure.data.notes.length);
  await refresh(page);
  results.push('Hostile/mismatched source marker stays unresolved and cannot be manually overridden');

  // Marked incomplete destinations cannot become ready even with a matching URL.
  await page.evaluate(()=>document.querySelector('main').setAttribute('aria-busy','true'));
  await page.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='incomplete');
  assert.equal(await page.evaluate(()=>CSS.highlights.has('margin-notes')),false);
  await page.evaluate(()=>document.querySelector('main').removeAttribute('aria-busy'));await ready();
  await refresh(page);
  results.push('Matching identity with incomplete content cannot attach; completion recovers');

  // Same-URL entries still suspend drafts; a URL string comparison alone misses this.
  await panel.getByRole('button',{name:'Edit',exact:true}).click();await panel.locator('#body').fill('Same URL retained');
  await page.evaluate(()=>history.replaceState({newView:true},'',location.href));
  await ready();assert(await panel.locator('#save').isDisabled());assert.equal(await panel.locator('#body').inputValue(),'Same URL retained');
  await panel.locator('#cancel').click();assert.deepEqual(await stored(worker),beforeFailure);
  await refresh(page);
  results.push('Same-URL replaceState changes the page session and suspends a draft');

  await refresh(page);const floodBefore=await isolated('diagnostics');
  await page.evaluate(()=>{for(let i=0;i<200;i++)history.replaceState({step:i},'',location.href);if(CSS.highlights.has('margin-notes'))throw new Error('Flood retained a highlight');});
  await ready();const floodAfter=await isolated('diagnostics');
  assert.equal(floodAfter.indexAttempts-floodBefore.indexAttempts,1);
  assert(floodAfter.notifications-floodBefore.notifications<=3);
  assert(floodAfter.navigationEvents-floodBefore.navigationEvents>=200 && floodAfter.navigationEvents-floodBefore.navigationEvents<=400);
  assert.deepEqual(await stored(worker),beforeFailure);await refresh(page);
  results.push('200 immediate same-URL replacements coalesce to one index and at most three notifications');

  // An unmarked transition remains blocked after Refresh; only explicit confirmation
  // can establish this source. Busy markers cannot be overridden by that button.
  await page.locator('#unmarked').click();await page.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='unresolved');
  await refresh(page);await noAttachment();assert(await panel.locator('#confirm-source').isVisible());
  await page.evaluate(()=>document.querySelector('main').setAttribute('aria-busy','true'));
  await page.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='unresolved');
  await panel.locator('#confirm-source').click();await panel.locator('#status').filter({hasText:'incomplete or busy'}).waitFor();await noAttachment();
  await page.evaluate(()=>document.querySelector('main').removeAttribute('aria-busy'));
  await page.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='unresolved');
  await panel.locator('#confirm-source').click();await ready();
  assert.deepEqual(await stored(worker),beforeFailure);
  await refresh(page);
  results.push('Refresh does not confirm unmarked identity; explicit confirmation cannot override busy content');
  await page.locator('#a').click();await ready();await refresh(page);
  return results;
}
