import assert from 'node:assert/strict';
import {navigationEdges} from './navigation-edges.mjs';

// The oracle knows only fixture paragraphs, saved records and the actual panel /
// CSS Highlight ranges. It never calls production identity or anchoring helpers.
export async function navigationSuite({page,worker,activate,create,refresh,stored,origin,download,upload,launch}) {
  const urlA=origin+'/navigation.html?conversation=A',urlB=origin+'/navigation.html?conversation=B';
  const quote='Shared 🌙 café café 日本語 👩‍👩‍👧‍👦 passage.';
  const panel=page.locator('#conversation-margin-notes-panel');
  const checks=[];
  async function waitWorker(fn) {const start=Date.now();while(!await worker.evaluate(fn)){if(Date.now()-start>5000)throw new Error('Worker hook timeout: '+await panel.locator('#status').textContent());await new Promise(r=>setTimeout(r,5));}}
  async function ready() {try {await page.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='ready');}catch(e){throw new Error(e.message+' '+await panel.locator('#anchors').textContent());}}
  async function unsettled() {await page.waitForFunction(()=>['unresolved','incomplete'].includes(document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state));}
  async function isolated(mode) {
    return worker.evaluate(async ({url,mode})=>{
      const tab=(await chrome.tabs.query({})).find(t=>t.url===url);
      const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:mode=>{
        if(mode==='delay') {globalThis.navigationDigest=crypto.subtle.digest.bind(crypto.subtle);crypto.subtle.digest=async(...args)=>{const result=await navigationDigest(...args);await new Promise(r=>setTimeout(r,250));return result;};}
        else if(mode==='delay-file') {
          globalThis.originalFileText=Blob.prototype.text;globalThis.fileStarted=false;
          Blob.prototype.text=async function(){const text=await originalFileText.call(this);globalThis.fileStarted=true;await new Promise(r=>{globalThis.fileRelease=r;});return text;};
        } else if(mode==='file-started')return globalThis.fileStarted;
        else if(mode==='release-file'){Blob.prototype.text=globalThis.originalFileText;globalThis.fileRelease();delete globalThis.originalFileText;delete globalThis.fileRelease;}
        else if(mode==='restore') {crypto.subtle.digest=globalThis.navigationDigest;delete globalThis.navigationDigest;}
        else return globalThis.marginPanel.diagnostics();
      },args:[mode]});return result;
    },{url:page.url(),mode});
  }
  await page.goto(urlA);await activate(page);await ready();await create(page,'target','Saved A');
  await page.evaluate(()=>document.querySelector('main').removeAttribute('data-margin-notes-source'));
  await unsettled();assert.equal(await panel.locator('article').count(),0);
  assert(await panel.locator('#confirm-source').isVisible());
  await page.evaluate(url=>document.querySelector('main').dataset.marginNotesSource=url,urlB);await unsettled();
  assert(await panel.locator('#confirm-source').isHidden());
  await page.evaluate(url=>document.querySelector('main').dataset.marginNotesSource=url,urlA);await ready();
  checks.push('Removing an initially accepted marker cannot silently downgrade to unmarked identity');
  await page.locator('#b').click();await unsettled();
  assert.equal(await panel.locator('article').count(),0);
  assert.equal(await page.evaluate(()=>CSS.highlights.has('margin-notes')),false);
  await ready();await create(page,'target','Saved B');
  await page.locator('#a').click();await ready();
  assert.match(await panel.locator('article').textContent(),/Saved A/);
  await panel.getByRole('button',{name:'Edit',exact:true}).click();
  await panel.getByLabel('Your note',{exact:true}).fill('Unsaved A 🌙 <img src=x onerror=alert(1)>');
  const baseline=await stored(worker),noteA=baseline.data.notes.find(n=>n.source===urlA),noteB=baseline.data.notes.find(n=>n.source===urlB);
  await page.exposeFunction('marginNavigationProgress',count=>console.log(`Navigation sequences: ${count} / 256`));
  const sequences=await page.evaluate(async ({urlA,urlB,quote,noteA,noteB,trials})=>{
    const shadow=document.querySelector('#conversation-margin-notes-panel').shadowRoot;
    const sleep=ms=>new Promise(r=>setTimeout(r,ms));
    const assert=(ok,label)=>{if(!ok)throw new Error(label);};
    async function wait(status) {await Promise.resolve();const start=performance.now();while(shadow.getElementById('anchors').dataset.state!==status){if(performance.now()-start>5000)throw new Error(`${status}: ${shadow.getElementById('anchors').textContent}`);await sleep(5);}}
    async function waitURL(url) {const start=performance.now();while(location.href!==url){if(performance.now()-start>5000)throw new Error('Traversal did not commit');await sleep(5);}}
    const baselineDraft=shadow.getElementById('body').value;
    function render(url,{duplicate=false,duplicateFirst=false,token='',marked=true}={}) {
      const root=document.createElement('main');if(marked)root.dataset.marginNotesSource=url;
      const who=new URL(url).searchParams.get('conversation');
      const blocks=[`Conversation ${who}`,quote,`End of ${who}.`];
      if(token)blocks.unshift(`Prefix ${token} 👩‍👩‍👧‍👦 café.`);
      if(duplicate){if(duplicateFirst)blocks.unshift(quote);else blocks.push(quote);}
      root.replaceChildren(...blocks.map((text,i)=>{const p=document.createElement('p');p.textContent=text;if(i===blocks.indexOf(quote))p.id='target';return p;}));
      document.querySelector('main').replaceWith(root);return blocks;
    }
    function invalid(label) {
      assert(!CSS.highlights.has('margin-notes')&&!CSS.highlights.has('margin-notes-active'),label+': highlights');
      assert(shadow.querySelectorAll('article').length===0,label+': no previous-source rows');
      assert(shadow.getElementById('save').disabled,label+': save suspended');
      assert(shadow.getElementById('body').value===baselineDraft,label+': draft retained');
    }
    function inspect(url,blocks,label) {
      const note=url===urlA?noteA:noteB,rows=[...shadow.querySelectorAll('article')];
      assert(rows.length===1&&rows[0].dataset.noteId===note.id,label+': identity');
      const text=blocks.join(' '),points=[...text],query=[...quote],hits=[];
      for(let i=0;i<=points.length-query.length;i++)if(query.every((c,j)=>points[i+j]===c))hits.push(i);
      const original=`Conversation ${url===urlA?'A':'B'} ${quote} End of ${url===urlA?'A':'B'}.`;
      const expected=text===original?'exact':hits.length===1?'uniquely reanchored':hits.length?'ambiguous':'missing';
      assert(rows[0].querySelector('.tag').textContent===expected,label+': status');
      const ranges=[...(CSS.highlights.get('margin-notes')||[])];
      assert(ranges.length===(hits.length===1?1:0),label+': range count');
      if(ranges.length) {
        assert(ranges[0].toString()===quote,label+': quote');
        assert(document.querySelector('main').contains(ranges[0].startContainer),label+': current root');
        const prefix=document.createRange();prefix.setStart(document.querySelector('main'),0);prefix.setEnd(ranges[0].startContainer,ranges[0].startOffset);
        // DOM Range text omits synthetic block separators; compare paragraph index
        // and text rather than reusing production DOM mapping.
        const para=ranges[0].startContainer.parentElement;
        assert([...document.querySelector('main').children].indexOf(para)===blocks.indexOf(quote),label+': correct paragraph');
      }
      assert(shadow.getElementById('body').value===baselineDraft,label+': retained draft');
      assert(shadow.getElementById('save').disabled,label+': explicit recovery required');
      return expected;
    }
    let seed=0xc019a71e;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
    const kinds=['push-delayed','replace-content-first','rapid','back-forward','hash','duplicate','unicode','unmarked'];
    const results=[];
    for(let trial=0;trial<trials;trial++)for(const kind of kinds) {
      history.replaceState({},'',urlA);render(urlA);
      shadow.getElementById('refresh').click();await sleep(10);await wait('ready');
      while(shadow.getElementById('refresh').disabled)await sleep(5);
      const token=random().toString(36),rapidCount=2+2*(random()%5),delayMs=160+random()%81,duplicateFirst=!!(random()%2),returnToken=random()%2?`return-${token}`:'',started=performance.now(),steps=[];
      if(kind==='replace-content-first') {
        render(urlB,{token});await sleep(200);invalid('content first');
        history.replaceState({},'',urlB);invalid('replace');
      } else if(kind==='hash') {
        history.pushState({},'',urlA+'#/conversation/B');invalid('hash');
        await wait('unresolved');invalid('hash unresolved');
        history.replaceState({},'',urlB);
      } else if(kind==='rapid') {
        for(let i=0;i<rapidCount;i++){history.pushState({},'',i%2?urlA:urlB);invalid('rapid '+i);}
        history.replaceState({},'',urlB);
      } else if(kind==='back-forward') {
        history.pushState({},'',urlB);render(urlB);await wait('ready');steps.push(inspect(urlB,[`Conversation B`,quote,'End of B.'],'B before back'));
        history.back();await waitURL(urlA);render(urlA);await wait('ready');steps.push(inspect(urlA,['Conversation A',quote,'End of A.'],'back A'));
        history.forward();await waitURL(urlB);
      } else {
        history.pushState({},'',urlB);invalid('push');
        if(kind==='push-delayed'){await sleep(delayMs);await wait('unresolved');invalid('old content');}
      }
      if(kind==='unmarked') {
        const blocks=render(urlB,{marked:false,token});await wait('unresolved');invalid('unmarked');
        shadow.getElementById('confirm-source').click();await wait('ready');
        steps.push(inspect(urlB,blocks,'manual confirmation'));
      } else {
        const blocks=render(urlB,{duplicate:kind==='duplicate',duplicateFirst,token});
        await wait('ready');steps.push(inspect(urlB,blocks,'destination'));
      }
      const destinationMs=performance.now()-started;
      history.pushState({},'',urlA);invalid('return A');const blocks=render(urlA,{token:returnToken});await wait('ready');steps.push(inspect(urlA,blocks,'return A'));
      assert(!shadow.getElementById('recover').disabled,'original draft can be recovered');
      results.push({trial,kind,token,rapidCount,delayMs,duplicateFirst,returnToken,steps,destinationMs,totalMs:performance.now()-started});
      if(results.length%32===0)await globalThis.marginNavigationProgress(results.length);
    }
    return {seed:'0xc019a71e',cases:results.length,counts:Object.fromEntries(kinds.map(k=>[k,results.filter(r=>r.kind===k).length])),anchorChecks:results.reduce((n,r)=>n+r.steps.length,0),results};
  },{urlA,urlB,quote,noteA,noteB,trials:Number(process.env.MARGIN_NAV_TRIALS)||32});
  assert.deepEqual(await stored(worker),baseline,'navigation and explicit identity confirmation never write notes');
  const metrics=await isolated('diagnostics');
  await panel.getByRole('button',{name:'Recover draft on this source',exact:true}).click();
  await panel.getByRole('button',{name:'Save note',exact:true}).click();
  await panel.locator('#status').filter({hasText:'Note updated'}).waitFor();
  assert.equal((await stored(worker)).data.notes.find(n=>n.id===noteA.id).body,'Unsaved A 🌙 <img src=x onerror=alert(1)>');
  assert.equal((await stored(worker)).data.notes.find(n=>n.id===noteB.id).body,'Saved B');
  checks.push(`${sequences.cases} seeded sequences; original draft explicitly recovered and saved only to A`);

  // Delayed native reads return a snapshot captured before navigation. The stale
  // reply must not overwrite a newer session or make its revision writable.
  for(let i=0;i<32;i++) {
    await worker.evaluate(()=>{globalThis.navigationGet=chrome.storage.local.get.bind(chrome.storage.local);globalThis.readCaptured=false;chrome.storage.local.get=async(...args)=>{const value=await navigationGet(...args);globalThis.readCaptured=true;await new Promise(r=>{globalThis.readRelease=r;});return value;};});
    await panel.locator('#refresh').click();
    try {await waitWorker(()=>globalThis.readCaptured);}catch(e){throw new Error(`Delayed read ${i}: ${e.message}`);}
    await page.evaluate(url=>history.pushState({},'',url),urlB);
    await page.locator('#a').click();
    await worker.evaluate(()=>{chrome.storage.local.get=globalThis.navigationGet;globalThis.readRelease();delete globalThis.navigationGet;delete globalThis.readRelease;});
    await ready();await page.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);
    assert.match(await panel.locator('article').textContent(),/Unsaved A/);
  }
  assert((await isolated('diagnostics')).async.staleReads>=32);
  checks.push('32 delayed storage snapshots discarded across A→B→A sessions');

  // A write accepted for A may finish after navigation; its immutable target is
  // still A. Its UI reply cannot cancel a draft in B or attach an A highlight.
  await panel.getByRole('button',{name:'Edit',exact:true}).click();await panel.getByLabel('Your note',{exact:true}).fill('A write completed after navigation');
  await worker.evaluate(()=>{globalThis.navigationSet=chrome.storage.local.set.bind(chrome.storage.local);globalThis.writeStarted=false;chrome.storage.local.set=async(...args)=>{globalThis.writeStarted=true;await new Promise(r=>setTimeout(r,300));return navigationSet(...args);};});
  await panel.locator('#save').click();await waitWorker(()=>globalThis.writeStarted);
  await page.locator('#b').click();await ready();
  await page.waitForFunction(()=>!document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('refresh').disabled);
  await worker.evaluate(()=>{chrome.storage.local.set=globalThis.navigationSet;delete globalThis.navigationSet;});
  assert.equal(await panel.getByLabel('Your note',{exact:true}).inputValue(),'A write completed after navigation');
  assert(await panel.locator('#save').isDisabled());assert.match(await panel.locator('article').textContent(),/Saved B/);
  assert.equal((await stored(worker)).data.notes.find(n=>n.id===noteA.id).body,'A write completed after navigation');
  assert((await isolated('diagnostics')).async.staleWrites>=1);
  await panel.locator('#cancel').click();checks.push('Accepted delayed write remains bound to A; stale success retains suspended draft in B');

  await page.locator('#a').click();await ready();await refresh(page);
  const beforeHash=await isolated('diagnostics');await isolated('delay');
  try {
    await page.evaluate(()=>{document.querySelector('main').lastElementChild.append(' interim');setTimeout(()=>document.querySelector('#b').click(),200);});
    await page.waitForURL(urlB);await ready();assert.match(await panel.locator('article').textContent(),/Saved B/);
    assert((await isolated('diagnostics')).discarded>beforeHash.discarded);
  } finally {await isolated('restore');}
  checks.push('Navigation during asynchronous fingerprint discards old anchor result');

  await page.locator('#a').click();await ready();await refresh(page);
  checks.push(...await navigationEdges({page,worker,panel,ready,refresh,stored,urlA,urlB,waitWorker,isolated}));
  const finalMetrics=await isolated('diagnostics');
  const exported=await download(page);
  await page.reload();await activate(page);await ready();assert.match(await panel.locator('article').textContent(),/A write completed/);
  checks.push('Reload preserves source identity and saved note');
  return {sequences,checks,exported,delayedReadSequences:32,metrics,finalMetrics,dom:{mainElements:await page.locator('main *').count(),panelElements:await panel.locator('*').count(),mountedRows:await panel.locator('article').count()}};
}

// Run after the first browser closes to keep browser/process resource use modest.
export async function navigationImport({launch,origin,upload,download,exported}) {
  const fresh=await launch('navigation-fresh'),other=await fresh.context.newPage();
  try {
    await other.goto(origin+'/navigation.html?conversation=B');await fresh.activate(other);await upload(other,exported);
    const panel=other.locator('#conversation-margin-notes-panel');
    await panel.locator('#status').filter({hasText:'Imported'}).waitFor();
    assert.equal(await panel.locator('article').count(),1);assert.match(await panel.locator('article').textContent(),/Saved B/);
    await other.locator('#a').click();await other.waitForFunction(()=>document.querySelector('#conversation-margin-notes-panel').shadowRoot.getElementById('anchors').dataset.state==='ready');
    assert.equal(await panel.locator('article').count(),1);assert.match(await panel.locator('article').textContent(),/A write completed/);
    assert.equal(await download(other),exported);
  } finally {await fresh.context.close();}
}
