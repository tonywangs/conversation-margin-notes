import assert from 'node:assert/strict';

export async function dynamicLimits({page,worker,refresh,stored,diagnostics,quote}) {
  const panel=page.locator('#conversation-margin-notes-panel');
  const before=await stored(worker),measurements=[];
  async function state(expected) {
    await page.waitForFunction(expected=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state===expected,expected);
  }
  async function reset() {
    await page.evaluate(quote=>{document.querySelector('#outside-limit')?.remove();document.querySelector('#second-root')?.remove();let main=document.querySelector('main');if(!main){main=document.createElement('main');document.body.append(main);}main.removeAttribute('aria-busy');main.removeAttribute('hidden');main.removeAttribute('contenteditable');main.innerHTML='<p>Ada prompt.</p><p id="target"></p><p>Bea ending.</p>';main.querySelector('#target').textContent=quote;},quote);
    await refresh(page);await state('ready');
  }
  async function noHighlights() {assert.equal(await page.evaluate(()=>CSS.highlights.has('margin-notes')||CSS.highlights.has('margin-notes-active')),false);}
  await reset();const start=await diagnostics();
  const continuous=await page.evaluate(async()=>{
    const started=performance.now(),root=document.querySelector('main'),p=document.createElement('p');root.append(p);
    const shadow=document.querySelector('#conversation-margin-notes-panel').shadowRoot;
    let pendingChecks=0;
    for(let i=0;i<35;i++) {
      p.textContent=`Streaming token ${i}`;await new Promise(resolve=>setTimeout(resolve,30));
      if(shadow.getElementById('anchors').dataset.state!=='pending'||CSS.highlights.has('margin-notes'))throw new Error('Streaming attached stale content');
      pendingChecks++;
    }
    return {pendingChecks,nominalDurationMs:35*30,elapsedMs:performance.now()-started};
  });
  const during=await diagnostics();assert.equal(during.indexAttempts,start.indexAttempts,'no indexing during continuous updates');
  await state('ready');const after=await diagnostics();assert.equal(after.indexAttempts-start.indexAttempts,1,'one index after quiet');
  measurements.push({name:'continuous streaming',...continuous,indexAttempts:after.indexAttempts-start.indexAttempts,quietToReadyMs:after.lastQuietToReadyMs});

  // Browser-created record list is large; application scans none of an overflow.
  await reset();const floodBefore=await diagnostics();
  await page.evaluate(()=>{const main=document.querySelector('main');for(let i=0;i<1001;i++)main.append(document.createElement('span'));});
  await state('incomplete');await noHighlights();let d=await diagnostics();assert.equal(d.paused,true);assert.equal(d.inspectedRecords,floodBefore.inspectedRecords);
  measurements.push({name:'1001-record overflow',maxBatchRecords:d.maxBatchRecords,inspectedDelta:d.inspectedRecords-floodBefore.inspectedRecords,paused:d.paused});
  await reset();

  // Frequent small batches are separately bounded even without a large batch.
  await page.evaluate(async()=>{const main=document.querySelector('main');for(let i=0;i<125;i++){main.setAttribute('data-stream',String(i));await new Promise(resolve=>setTimeout(resolve,5));}});
  await state('incomplete');await noHighlights();d=await diagnostics();assert(d.paused);
  assert.match(await panel.locator('#anchors').textContent(),/120 batches/);
  measurements.push({name:'125 small mutation batches',paused:d.paused});
  await reset();

  // Quiet-but-frequent edits cannot exceed the automatic indexing window budget.
  const rateBefore=await diagnostics();
  for(let i=0;i<8;i++) {
    await page.evaluate(i=>document.querySelector('main').setAttribute('data-rate',String(i)),i);
    await state(i===7?'incomplete':'ready');
  }
  d=await diagnostics();assert.equal(d.indexAttempts-rateBefore.indexAttempts,7);assert(d.paused);
  assert.match(await panel.locator('#anchors').textContent(),/8 attempts/);
  measurements.push({name:'index rate budget',automaticAttempts:d.indexAttempts-rateBefore.indexAttempts,paused:d.paused});
  await reset();

  const negatives=[
    ['busy marker',()=>document.querySelector('main').setAttribute('aria-busy','true'),/incomplete or busy/],
    ['editable root',()=>document.querySelector('main').setAttribute('contenteditable','true'),/Unsupported conversation root/],
    ['hidden root',()=>document.querySelector('main').hidden=true,/hidden/],
    ['missing root',()=>document.querySelector('main').remove(),/Unsupported page/],
    ['multiple roots',()=>{const n=document.createElement('main');n.id='second-root';document.body.append(n);},/exactly one/],
    ['normalized text bound',()=>document.querySelector('main').textContent='x'.repeat(200001),/200,000/],
    ['raw text bound',()=>document.querySelector('main').textContent=' '.repeat(400001),/400,000/],
    ['visited node bound',()=>document.querySelector('main').replaceChildren(...Array.from({length:10001},()=>document.createElement('span'))),/10,000/],
    ['depth bound',()=>{let parent=document.querySelector('main');parent.replaceChildren();for(let i=0;i<130;i++){const child=document.createElement('div');parent.append(child);parent=child;}},/128 nested/],
    ['discovery bound',()=>{const outside=document.createElement('div');outside.id='outside-limit';outside.append(...Array.from({length:20001},()=>document.createTextNode(' ')));document.body.append(outside);},/20,000/]
  ];
  for(const [name,change,pattern] of negatives) {
    await page.evaluate(change);await state('incomplete');await noHighlights();assert.match(await panel.locator('#anchors').textContent(),pattern);
    assert.deepEqual(await stored(worker),before);measurements.push({name,status:'incomplete'});await reset();
  }
  // Removal / addition and incomplete markers recover automatically, without read
  // or write traffic to storage and without a user refresh.
  await page.evaluate(()=>document.querySelector('main').setAttribute('aria-busy','true'));await state('incomplete');
  await page.evaluate(()=>document.querySelector('main').removeAttribute('aria-busy'));await state('ready');
  assert.equal(await panel.locator('.tag').textContent(),'exact');
  await page.evaluate(()=>{globalThis.savedRoot=document.querySelector('main');savedRoot.remove();});await state('incomplete');
  await page.evaluate(()=>document.body.append(globalThis.savedRoot));await state('ready');
  assert.equal(await panel.locator('.tag').textContent(),'exact');
  measurements.push({name:'automatic incomplete and removed-root recovery',status:'exact'});

  // Invalid URL identities fail closed, including during row-status updates.
  const validURL=page.url();
  await page.evaluate(()=>{history.replaceState({},'',`?${'x'.repeat(4100)}`);document.querySelector('main').append(' URL changed.');});
  await state('incomplete');await noHighlights();assert.match(await panel.locator('#anchors').textContent(),/Invalid source URL/);
  await page.evaluate(url=>history.replaceState({},'',url),validURL);await reset();
  measurements.push({name:'unsupported URL identity',status:'incomplete'});

  // Normalization-only and identical-container changes recover exact automatically.
  await page.evaluate(()=>{const main=document.querySelector('main');for(const p of main.children)p.textContent=' \n'+p.textContent.replaceAll(' ','\t  ')+' ';});
  await state('ready');assert.equal(await panel.locator('.tag').textContent(),'exact');
  await page.evaluate(()=>{const main=document.querySelector('main');main.replaceWith(main.cloneNode(true));});
  await state('ready');assert.equal(await panel.locator('.tag').textContent(),'exact');
  measurements.push({name:'normalization and identical replacement',status:'exact'});
  await reset();
  // Failed edits and their diagnostics survive automatic page updates as well.
  await panel.getByRole('button',{name:'Edit',exact:true}).click();
  await panel.getByLabel('Your note',{exact:true}).fill('Keep this failed draft.');
  await worker.evaluate(()=>{globalThis.dynamicSavedSet=chrome.storage.local.set;chrome.storage.local.set=async()=>{throw new Error('Dynamic save failure');};});
  try {
    await panel.getByRole('button',{name:'Save note',exact:true}).click();
    await panel.locator('#status').filter({hasText:'Dynamic save failure'}).waitFor();
    await page.evaluate(()=>document.querySelector('main').lastElementChild.append(' New message.'));await state('ready');
    assert.equal(await panel.getByLabel('Your note',{exact:true}).inputValue(),'Keep this failed draft.');
    assert.match(await panel.locator('#status').textContent(),/Dynamic save failure/);
    assert.deepEqual(await stored(worker),before);
  } finally {await worker.evaluate(()=>{chrome.storage.local.set=globalThis.dynamicSavedSet;delete globalThis.dynamicSavedSet;});}
  await panel.getByRole('button',{name:'Cancel draft',exact:true}).click();
  assert.deepEqual(await stored(worker),before);
  measurements.push({name:'failed edit during automatic updates and cancellation',storedNotesUnchanged:true});

  // Force an async fingerprint race in the installed isolated world. Only the
  // native digest timing is changed, not its value or the production observer.
  await reset();
  async function isolated(func) {
    return worker.evaluate(async ({url,source})=>{
      const tab=(await chrome.tabs.query({})).find(t=>t.url===url);
      // No eval: select one of two explicit test functions.
      await chrome.scripting.executeScript({target:{tabId:tab.id},func:source==='delay'?()=>{
        globalThis.originalDigest=crypto.subtle.digest.bind(crypto.subtle);
        crypto.subtle.digest=async(...args)=>{const result=await originalDigest(...args);await new Promise(resolve=>setTimeout(resolve,250));return result;};
      }:()=>{crypto.subtle.digest=globalThis.originalDigest;delete globalThis.originalDigest;}});
    },{url:page.url(),source:func});
  }
  const raceBefore=await diagnostics();await isolated('delay');
  try {
    await page.evaluate(()=>{document.querySelector('#target').textContent='Transient old result.';setTimeout(()=>document.querySelector('#target').textContent='Final changed result.',220);});
    await state('ready');assert.equal(await panel.locator('.tag').textContent(),'missing');
    d=await diagnostics();assert(d.discarded>raceBefore.discarded,'stale asynchronous result discarded');
    measurements.push({name:'mutation during fingerprint',discarded:d.discarded-raceBefore.discarded,status:'missing'});
  } finally {await isolated('restore');}
  await reset();

  // Frozen modest workload: exactly 1,000 additional paragraphs of known text.
  await page.evaluate(()=>{const fragment=document.createDocumentFragment();for(let i=0;i<1000;i++){const p=document.createElement('p');p.textContent=`Message ${String(i).padStart(4,'0')}: `+'measured text '.repeat(4);fragment.append(p);}document.querySelector('main').append(fragment);});
  await state('ready');await refresh(page);
  const workloadBefore=await diagnostics(),latencies=[];
  for(let i=0;i<5;i++) {
    const started=performance.now();await page.evaluate(i=>document.querySelector('main').lastElementChild.firstChild.data=`Frozen workload final message ${i}.`,i);await state('ready');latencies.push(performance.now()-started);
  }
  const workloadAfter=await diagnostics();
  measurements.push({name:'1000-paragraph workload',mutations:5,latenciesMs:latencies,indexAttempts:workloadAfter.indexAttempts-workloadBefore.indexAttempts,commits:workloadAfter.commits-workloadBefore.commits,maxVisitedNodes:workloadAfter.maxVisitedNodes,maxDiscoveryNodes:workloadAfter.maxDiscoveryNodes,meanIndexMs:(workloadAfter.totalIndexMs-workloadBefore.totalIndexMs)/(workloadAfter.indexAttempts-workloadBefore.indexAttempts),lifetimeMaxIndexMsIncludingFaultDelay:workloadAfter.maxIndexMs,domElements:await page.locator('main *').count(),mountedRows:await panel.locator('article').count(),panelElements:await panel.locator('*').count()});
  // A closed panel stays closed and does not repaint highlights on page updates.
  await panel.getByRole('button',{name:'Close notes panel'}).click();
  await page.evaluate(()=>document.querySelector('main').lastElementChild.append(' Closed.'));await state('ready');await noHighlights();
  assert.deepEqual(await stored(worker),before);
  return {measurements,finalMetrics:await diagnostics()};
}
