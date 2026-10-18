import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../extension/core.js';
import '../extension/drafts.js';
const D=globalThis.MarginDrafts;
const note={id:'11111111-1111-4111-8111-111111111111',source:'https://example.test/chat',body:'',created:'2026-10-18T00:00:00.000Z',updated:'2026-10-18T00:00:00.000Z',selector:{quote:'hello',prefix:'',suffix:'',start:0,end:5,fingerprint:'a'.repeat(64)}};
const draft=()=>({id:crypto.randomUUID(),version:0,note:structuredClone(note),baseRevision:0,baseNote:null,body:'unsaved 🌙'});
test('draft versions reject stale writes, stale discard, identity changes and deleted records',()=>{
 const a=draft(),one=D.replace(D.envelope(),a),b=one.entries[0];
 assert.equal(b.version,1);assert.throws(()=>D.replace(one,a),/another tab/);
 assert.throws(()=>D.replace(one,{...b,baseRevision:1}),/identity/);
 assert.throws(()=>D.remove(one,b.id,0),/another tab/);
 const empty=D.remove(one,b.id,1);assert.throws(()=>D.replace(empty,b),/another tab/);
 assert.equal(one.entries[0].body,a.body);
});
test('draft bounds never evict records; Unicode, schema and note format are validated',()=>{
 let store=D.envelope();for(let i=0;i<32;i++)store=D.replace(store,draft());
 const before=JSON.stringify(store);assert.throws(()=>D.replace(store,draft()),/32 drafts/);assert.equal(JSON.stringify(store),before);
 assert.throws(()=>D.record({...draft(),body:'x'.repeat(8001)}),/8,000/);
 assert.throws(()=>D.record({...draft(),body:'\ud800'}),/Unicode/);
 assert.equal(D.record({...draft(),body:'🌙'.repeat(8000)}).body.length,16000);
 assert.throws(()=>D.record({...draft(),extra:true}),/fields/);
 assert.throws(()=>D.record({...draft(),note:{...note,body:'oops'}}),/empty/);
 let large=D.envelope();assert.throws(()=>{for(let i=0;i<32;i++)large=D.replace(large,{...draft(),body:'\u0000'.repeat(8000)});},/1 MiB/);
});
test('base revision survives refresh; conflicts and exact already-saved content are distinct',()=>{
 const d=draft(),state={revision:0,data:{version:1,notes:[]}};
 assert.equal(D.assessment(d,state),'ready');
 assert.equal(D.assessment(d,{...state,revision:1}),'conflict');
 const saved={...note,body:d.body};assert.equal(D.assessment(d,{revision:1,data:{version:1,notes:[saved]}}),'saved');
 assert.equal(D.assessment(d,{revision:1,data:{version:1,notes:[{...saved,body:'newer'}]}}),'conflict');
 const edit={...d,note:{...saved,body:''},baseNote:saved,baseRevision:1,body:'edit'};
 assert.equal(D.assessment(edit,{revision:1,data:{version:1,notes:[saved]}}),'ready');
 assert.equal(D.assessment(edit,{revision:2,data:{version:1,notes:[]}}),'conflict');
});

await import('../extension/draft-writer.js');
test('coalesced writer acknowledges only its snapshot, retries failures and stops before discard',async()=>{
 const pending=[],stats={writes:0,failures:0,acknowledgments:0};
 const editor=MarginDraftWriter.create(draft(),{stats,rpc:msg=>new Promise((resolve,reject)=>pending.push({msg,resolve,reject}))});
 const work=editor.flush();await Promise.resolve();assert.equal(pending.length,1);
 const first=pending[0];editor.edit('new input during write');assert.equal(editor.ackBody,null);
 first.resolve({...first.msg.draft,version:1});await new Promise(r=>setImmediate(r));
 assert.equal(editor.ackBody,first.msg.draft.body);assert.equal(editor.body,'new input during write');assert.equal(pending.length,2);
 pending[1].reject(new Error('quota'));assert.equal(await work,false);assert.equal(editor.record.version,1);
 assert.equal(editor.body,'new input during write');assert.equal(editor.error,'quota');
 const retry=editor.flush();await Promise.resolve();pending[2].resolve({...pending[2].msg.draft,version:2});assert.equal(await retry,true);
 assert.equal(editor.ackBody,editor.body);assert.equal(stats.writes,3);assert.equal(stats.failures,1);
 editor.edit('do not enqueue after stopping');const stopping=editor.stop();await stopping;assert.equal(await editor.flush(),true);assert.equal(pending.length,3);
});
