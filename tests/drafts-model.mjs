// Production worker + coalescing writer; independent lifecycle reference ledger.
// Storage is simulated here. Installed Chromium checks cover its native boundary.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import '../extension/core.js';
import '../extension/drafts.js';
import '../extension/draft-writer.js';
const scripts={};for(const name of ['core.js','drafts.js','worker.js'])scripts[name]=await readFile(new URL('../extension/'+name,import.meta.url),'utf8');
const clone=structuredClone;
const seed=0xD4AF7108;
const idFor=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${n.toString(16).padStart(12,'0')}`;
function randomGenerator(seed){let v=seed;return()=>{v^=v<<13;v^=v>>>17;v^=v<<5;return (v>>>0)/4294967296;};}
function harness(initial) {
 const disk={...clone(initial)},boundary={fail:false,gate:null,entered:null,writes:0},tab={id:1,url:'https://example.test/a'};
 let listener;
 function restart() {
  const context=vm.createContext({URL,TextEncoder,crypto:webcrypto,console,structuredClone,Date,chrome:{
   storage:{local:{setAccessLevel:async()=>{},get:async key=>clone({[key]:disk[key]}),set:async value=>{
    boundary.writes++;if(boundary.gate){boundary.entered?.();await boundary.gate;boundary.gate=null;}
    if(boundary.fail){boundary.fail=false;throw new Error('model injected quota failure');}Object.assign(disk,clone(value));
   }}},tabs:{get:async()=>clone(tab)},runtime:{id:'test',getURL:name=>'chrome-extension://test/'+name,onMessage:{addListener:fn=>{listener=fn;}}},action:{onClicked:{addListener:()=>{}}}
  }});
  context.importScripts=(...names)=>{for(const n of names)vm.runInContext(scripts[n],context);};
  vm.runInContext(scripts['worker.js'],context);
 }
 restart();
 const rpc=message=>new Promise((resolve,reject)=>{const accepted=listener(clone(message),{id:'test',tab:{id:2},frameId:0,url:'chrome-extension://test/secure.html?tab=1'},response=>response.ok?resolve(clone(response.value)):reject(new Error(response.error)));if(!accepted)reject(new Error('Model message sender rejected.'));});
 return {disk,boundary,tab,rpc,restart};
}
export async function draftModelSuite() {
 const random=randomGenerator(seed),counts={edit:0,ack:0,delayedAck:0,failure:0,navigation:0,reload:0,recovery:0,conflict:0,discard:0,save:0,staleWriter:0};
 const sequences=[];
 for(let trial=0;trial<320;trial++) {
  const edit=trial%2===0,now='2026-10-18T00:00:00.000Z';
  const note={id:idFor(trial*2),source:'https://example.test/a',body:'',created:now,updated:now,selector:{quote:'hello',prefix:'',suffix:'',start:0,end:5,fingerprint:'a'.repeat(64)}};
  const original=edit?{...note,body:'original'}:null;
  const h=harness({notebook:{revision:0,data:{version:1,notes:original?[original]:[]}}});
  const record={id:idFor(trial*2+1),version:0,note,baseRevision:0,baseNote:original,body:edit?'original':''};
  let writer=MarginDraftWriter.create(record,{rpc:h.rpc});
  // The oracle owns only user-visible text, acknowledged text/version, source,
  // note contents and an integer notebook revision. It calls no production reducer.
  const ref={text:record.body,persisted:null,version:0,revision:0,note:clone(original),source:note.source};
  const trace=[];
  const check=()=>{
   const actual=h.disk.drafts?.entries.find(d=>d.id===record.id);
   assert.equal(actual?.body??null,ref.persisted,`trial ${trial}: ${trace}`);
   assert.equal(actual?.version??0,ref.version);
   assert.equal(h.disk.notebook.revision,ref.revision);
   assert.deepEqual(h.disk.notebook.data.notes,ref.note?[ref.note]:[]);
   if(writer){assert.equal(writer.body,ref.text);assert.equal(writer.ackBody,ref.persisted);}
  };
  // Every sequence includes delayed acknowledgment with intervening input.
  ref.text=`first ${trial} 🌙`;writer.edit(ref.text);
  let release,entered;const seen=new Promise(r=>{entered=r;});h.boundary.entered=entered;h.boundary.gate=new Promise(r=>{release=r;});
  const pending=writer.flush();await seen;
  assert.equal(writer.ackBody,null);ref.text=`during write ${trial} <script>${Math.floor(random()*1e6)}</script>`;writer.edit(ref.text);
  assert.equal(writer.ackBody,null);h.tab.url='https://example.test/b';ref.source=h.tab.url;counts.navigation++;trace.push('navigate during ack');
  release();assert(await pending);ref.persisted=ref.text;ref.version=2;counts.delayedAck++;counts.ack+=2;check();
  // Loss of a failed new edit is explicit on simulated renderer/browser restart:
  // the last acknowledged snapshot must still exist, not the rejected text.
  ref.text+=` pending ${Math.floor(random()*1000)}`;writer.edit(ref.text);h.boundary.fail=true;
  assert.equal(await writer.flush(),false);counts.failure++;check();
  await writer.stop();writer=null;h.restart();ref.text=ref.persisted;counts.reload++;trace.push('restart');check();
  h.tab.url='https://example.test/a';ref.source=h.tab.url;
  const list=await h.rpc({type:'draft-list'});writer=MarginDraftWriter.create(list.entries[0],{rpc:h.rpc});counts.recovery++;check();
  // Seeded editing bursts with controlled successful/failed commits.
  for(let step=0,steps=3+Math.floor(random()*8);step<steps;step++) {
   ref.text=`${trial}:${step}:${Math.floor(random()*1e9)} ${'🌌'.repeat(1+Math.floor(random()*10))}`;writer.edit(ref.text);counts.edit++;
   const fail=random()<.25;h.boundary.fail=fail;
   const ok=await writer.flush();assert.equal(ok,!fail);
   if(fail)counts.failure++;else {ref.persisted=ref.text;ref.version++;counts.ack++;}
   check();
  }
  if(ref.text!==ref.persisted){await writer.flush();ref.persisted=ref.text;ref.version++;counts.ack++;}
  // Another editor recovering the same snapshot must not overwrite a winner.
  const other=MarginDraftWriter.create(clone(writer.record),{rpc:h.rpc});
  ref.text+=' winner';writer.edit(ref.text);await writer.flush();ref.persisted=ref.text;ref.version++;
  other.edit('stale tab');assert.equal(await other.flush(),false);assert.equal(other.body,'stale tab');await other.stop();counts.staleWriter++;check();
  if(trial%4<2) {
   // External saved-note changes or deletion. This is an independently specified
   // external event, not a call through the implementation under test.
   ref.revision++;ref.note=trial%4===0?{...note,body:'newer saved note'}:null;
   h.disk.notebook={revision:ref.revision,data:{version:1,notes:ref.note?[clone(ref.note)]:[]}};
   assert.equal(MarginDrafts.assessment(writer.record,h.disk.notebook),'conflict');
   const op=edit?{type:'edit',id:note.id,body:ref.text}:{type:'create',note:{...note,body:ref.text}};
   await assert.rejects(h.rpc({...op,draftId:record.id,draftVersion:ref.version,revision:ref.revision,contextSource:note.source,contextURL:note.source}),/another tab/);
   counts.conflict++;trace.push('conflict');check();
  } else {
   assert.equal(MarginDrafts.assessment(writer.record,h.disk.notebook),'ready');
   const op=edit?{type:'edit',id:note.id,body:ref.text}:{type:'create',note:{...note,body:ref.text}};
   const response=await h.rpc({...op,draftId:record.id,draftVersion:ref.version,revision:0,contextSource:note.source,contextURL:note.source});
   assert.equal(response.data.notes[0].body,ref.text);assert.equal(response.data.notes[0].source,note.source);
   // Date is generated by the worker; verify it independently, then include it.
   assert(Number.isFinite(Date.parse(response.data.notes[0].updated)));
   ref.note={...note,body:ref.text,updated:response.data.notes[0].updated};ref.revision=1;
   await writer.stop();writer=null;ref.persisted=null;ref.version=0;counts.save++;check();
  }
  if(writer) {
   await writer.stop();await h.rpc({type:'draft-discard',id:record.id,version:ref.version});writer=null;ref.persisted=null;ref.version=0;counts.discard++;check();
  }
  sequences.push({trial,mode:edit?'edit':'create',outcome:trial%4<2?'conflict then discard':'saved',storageWrites:h.boundary.writes});
 }
 return {seed,cases:sequences.length,counts,sequences,limitations:'Deterministic simulated storage with production worker and writer. Navigation and restart are harness events; installed browser tests separately validate panel/session behavior and native persistence.'};
}
