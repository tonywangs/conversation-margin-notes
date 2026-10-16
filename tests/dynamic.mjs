import assert from 'node:assert/strict';
import {dynamicLimits} from './dynamic-limits.mjs';

// Runs against the installed extension in its isolated world. This oracle has no
// access to MarginCore, MarginDOM or MarginTracker. It searches code-point arrays
// from a separate paragraph model and compares actual CSS Highlight ranges.
export async function dynamicSuite({page,worker,activate,create,refresh,stored,origin}) {
  const quote='Target 🌙 café café 日本語 👩‍👩‍👧‍👦.';
  await page.goto(origin+'/blank.html?dynamic');
  await page.evaluate(quote=>{
    document.querySelector('main').innerHTML='<p id="before">Ada prompt.</p><p id="target"></p><p id="tail">Bea ending.</p>';
    document.querySelector('#target').textContent=quote;
    const stable=document.createElement('p');stable.id='stable-selection';stable.textContent='Selection outside the changing conversation.';document.body.prepend(stable);
  },quote);
  await activate(page);await create(page,'target','Original dynamic note.');
  const panel=page.locator('#conversation-margin-notes-panel');
  const baselineStorage=await stored(worker);
  // Selection and a focused row button survive a normal automatic update.
  const selection=await page.evaluate(async()=>{
    const shadow=document.querySelector('#conversation-margin-notes-panel').shadowRoot;
    const button=shadow.querySelector('[data-action="jump"]');button.focus();
    const n=document.querySelector('#stable-selection').firstChild,r=document.createRange();r.setStart(n,0);r.setEnd(n,9);getSelection().removeAllRanges();getSelection().addRange(r);
    document.querySelector('#tail').append(' Extra.');
    await new Promise(resolve=>setTimeout(resolve,350));
    return {selection:getSelection().toString(),focused:shadow.activeElement===button,tag:shadow.querySelector('.tag').textContent};
  });
  assert.deepEqual(selection,{selection:'Selection',focused:true,tag:'uniquely reanchored'});
  await panel.getByRole('button',{name:'Edit',exact:true}).click();
  await panel.getByLabel('Your note',{exact:true}).fill('Unsaved draft 🌙 — keep my caret.');
  await page.exposeFunction('marginSequenceProgress',count=>console.log(`Dynamic sequences: ${count} / 256`));
  const sequences=await page.evaluate(async quote=>{
    const shadow=document.querySelector('#conversation-margin-notes-panel').shadowRoot;
    const field=shadow.getElementById('body'),row=shadow.querySelector('article');field.setSelectionRange(3,12,'backward');
    const draft=field.value,baseline=[{id:'before',text:'Ada prompt.'},{id:'target',text:quote},{id:'tail',text:'Bea ending.'}];
    const normalize=s=>s.replace(/\s+/gu,' ').trim(),canonical=blocks=>blocks.map(b=>normalize(b.text)).filter(Boolean).join(' ');
    const original=canonical(baseline),quotePoints=[...quote],originalStart=[...'Ada prompt. '].length;
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const assert=(ok,label)=>{if(!ok)throw new Error(label);};
    const ready=async()=>{const start=performance.now();while(shadow.getElementById('anchors').dataset.state!=='ready') {if(performance.now()-start>5000)throw new Error(shadow.getElementById('anchors').textContent);await sleep(10);}};
    function oracle(blocks) {
      const text=canonical(blocks),points=[...text],hits=[];
      // Deliberately not String.indexOf or the production anchor implementation.
      for(let i=0;i<=points.length-quotePoints.length;i++) if(quotePoints.every((c,j)=>points[i+j]===c))hits.push(i);
      if(text===original)return {status:'exact',start:originalStart};
      return hits.length===0?{status:'missing'}:hits.length===1?{status:'uniquely reanchored',start:hits[0]}:{status:'ambiguous'};
    }
    function inspect(blocks,label) {
      const expected=oracle(blocks),tag=shadow.querySelector('.tag').textContent;
      assert(tag===expected.status,`${label}: ${tag} != ${expected.status}`);
      const ranges=[...(CSS.highlights.get('margin-notes')||[])];
      assert(ranges.length===(expected.start===undefined?0:1),`${label}: highlight count`);
      if(ranges.length) {
        const range=ranges[0];assert(normalize(range.toString())===quote,`${label}: range text`);
        const root=document.querySelector('main');let paragraph=range.startContainer.parentElement;
        while(paragraph.parentElement!==root)paragraph=paragraph.parentElement;
        let position=0;
        for(const child of root.children) {if(child===paragraph)break;position += [...normalize(child.textContent)].length+1;}
        const prefix=document.createRange();prefix.selectNodeContents(paragraph);prefix.setEnd(range.startContainer,range.startOffset);
        position += [...prefix.toString().replace(/\s+/gu,' ').trimStart()].length;
        assert(position===expected.start,`${label}: DOM offset ${position} != ${expected.start}`);
      }
      return expected;
    }
    async function mutate(fn,blocks,label) {
      const start=performance.now();fn();await Promise.resolve();
      assert(shadow.getElementById('anchors').dataset.state==='pending',`${label}: immediate pending`);
      assert(shadow.querySelector('.tag').textContent==='pending',`${label}: row pending`);
      assert(!CSS.highlights.has('margin-notes')&&!CSS.highlights.has('margin-notes-active'),`${label}: stale highlights removed`);
      await ready();const expected=inspect(blocks,label);
      return {...expected,latencyMs:performance.now()-start};
    }
    function p(block) {const node=document.createElement('p');node.id=block.id;node.textContent=block.text;return node;}
    let seed=0x72ac19ef;
    const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
    const kinds=['streaming','duplicate','unicode','moved','replaced','removed','edited','markup'],results=[];
    for(let trial=0;trial<32;trial++) for(const kind of kinds) {
      const token=random().toString(36),root=document.querySelector('main');
      root.replaceChildren(...baseline.map(p));
      // Reset the per-window budget between independent sequences, never between
      // the automatic intermediate mutations whose results are being measured.
      shadow.getElementById('refresh').click();
      await sleep(10);await ready();
      while(shadow.getElementById('refresh').disabled)await sleep(5);
      field.focus();field.setSelectionRange(3,12,'backward');
      const mounted=shadow.querySelector('article');
      const blocks=structuredClone(baseline),steps=[];
      const extra={id:'prefix',text:`Preface ${token} 🌌.`};blocks.unshift(extra);
      steps.push(await mutate(()=>root.prepend(p(extra)),blocks,`${trial} ${kind} prefix`));
      if(kind==='streaming') {
        const stream={id:'stream',text:''},node=p(stream);blocks.push(stream);
        const chunks=[`Streaming ${token}`, ' café', ' 🌙', ' 日本語', ' complete.'];
        for(let i=0;i<chunks.length;i++) {
          stream.text+=chunks[i];node.textContent=stream.text;if(i===0)root.append(node);
          await Promise.resolve();assert(shadow.querySelector('.tag').textContent==='pending','stream pending');assert(!CSS.highlights.has('margin-notes'),'stream clears highlight');await sleep(25);
        }
        await ready();steps.push(inspect(blocks,'stream final'));
      } else if(kind==='duplicate') {
        const duplicate={id:'copy',text:quote};blocks.push(duplicate);
        steps.push(await mutate(()=>root.append(p(duplicate)),blocks,'duplicate'));
        blocks.pop();steps.push(await mutate(()=>document.querySelector('#copy').remove(),blocks,'duplicate removed'));
      } else if(kind==='unicode') {
        blocks[0].text=`\t👩‍👩‍👧‍👦\n 日本語  café ${token}\u00a0`;
        steps.push(await mutate(()=>document.querySelector('#prefix').textContent=blocks[0].text,blocks,'Unicode whitespace'));
      } else if(kind==='moved') {
        const moved=blocks.splice(2,1)[0];blocks.push(moved);
        steps.push(await mutate(()=>root.append(document.querySelector('#target')),blocks,'moved'));
      } else if(kind==='replaced') {
        steps.push(await mutate(()=>{const replacement=document.createElement('main');replacement.append(...blocks.map(p));root.replaceWith(replacement);},blocks,'container replaced'));
      } else if(kind==='removed') {
        blocks.splice(2,1);steps.push(await mutate(()=>document.querySelector('#target').remove(),blocks,'removed'));
        blocks.push(baseline[1]);steps.push(await mutate(()=>root.append(p(baseline[1])),blocks,'restored'));
      } else if(kind==='edited') {
        blocks[2].text=`Edited ${token}`;
        steps.push(await mutate(()=>document.querySelector('#target').firstChild.data=blocks[2].text,blocks,'edited'));
        blocks[2].text=quote;steps.push(await mutate(()=>document.querySelector('#target').firstChild.data=quote,blocks,'edit restored'));
      } else {
        steps.push(await mutate(()=>{const target=document.querySelector('#target');target.replaceChildren(...[...quote].map(c=>{const span=document.createElement(random()%2?'em':'strong');span.textContent=c;return span;}));},blocks,'markup'));
      }
      assert(shadow.querySelector('article')===mounted,'auto update preserves mounted row');
      assert(field.value===draft && shadow.activeElement===field && field.selectionStart===3 && field.selectionEnd===12 && field.selectionDirection==='backward','draft, focus and caret preserved');
      results.push({trial,kind,token,steps});
      if(results.length%32===0)await globalThis.marginSequenceProgress(results.length);
    }
    return {seed:'0x72ac19ef',cases:results.length,counts:Object.fromEntries(kinds.map(kind=>[kind,results.filter(r=>r.kind===kind).length])),intermediateChecks:results.reduce((n,r)=>n+r.steps.length,0),results};
  },quote);
  assert.deepEqual(await stored(worker),baselineStorage,'automatic updates never write stored notes');
  await panel.getByRole('button',{name:'Cancel draft',exact:true}).click();
  assert.deepEqual(await stored(worker),baselineStorage,'cancellation never writes stored notes');
  async function diagnostics() {
    return worker.evaluate(async url=>{
      const tabs=await chrome.tabs.query({});const tab=tabs.find(t=>t.url===url);
      const [{result}]=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>globalThis.marginPanel.diagnostics()});return result;
    },page.url());
  }
  const sequenceMetrics=await diagnostics();
  const limits=await dynamicLimits({page,worker,refresh,stored,diagnostics,quote});
  return {sequences,sequenceMetrics,selection,limits};
}
