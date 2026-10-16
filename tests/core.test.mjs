import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import '../extension/core.js';
const C=globalThis.MarginCore;
const digest=s=>createHash('sha256').update(s).digest('hex');
const note=(i=1)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,source:'https://example.test/chat?conversation=1',body:'A thought 🌙',created:'2026-01-01T00:00:00.000Z',updated:'2026-01-01T00:00:00.000Z',selector:{quote:'🌙 café',prefix:'Before ',suffix:' after',start:7,end:13,fingerprint:digest('Before 🌙 café after')}});
const data=(notes=[note()])=>({version:1,notes});
test('Unicode offsets, context, digest and normalization',async()=>{
  const text='Before 🌙 café after';assert.equal(C.normalize(' \tBefore\u00a0🌙\n café  after '),text);
  assert.equal(await C.fingerprint(text),digest(text));assert.deepEqual(C.quoteAt(text,7,13,digest(text)),note().selector);
  assert.throws(()=>C.quoteAt(text,-1,2,digest(text)));assert.throws(()=>C.quoteAt(text,1,3000,digest(text)));
});
test('conservative anchoring: changed duplicates never use position or context to guess',()=>{
  const text='Left same Right';const s=C.quoteAt(text,5,9,digest(text));
  assert.deepEqual(C.anchor(text,digest(text),s),{status:'exact',start:5,end:9});
  assert.equal(C.anchor('Left same Right same',digest('changed'),s).status,'ambiguous');
  assert.equal(C.anchor('Left gone Right',digest('removed'),s).status,'missing');
  assert.deepEqual(C.anchor('🌙 '+text,digest('moved'),s),{status:'uniquely reanchored',start:7,end:11});
  assert.equal(C.anchor('aaa',digest('new'),{quote:'aa',fingerprint:digest('old')}).status,'ambiguous');
  assert.equal(C.anchor(text,digest(text),{...s,start:0,end:4}).status,'missing');
});
test('deterministic portable envelope and atomic duplicate policy',()=>{
  assert.equal(C.serialize(data([note(2),note(1)])),C.serialize(data([note(1),note(2)])));
  assert.deepEqual(C.parse(C.serialize(data())),data());
  assert.deepEqual(C.merge(data(),data()),{data:data(),skipped:1,added:0});
  const original=JSON.stringify(data());assert.throws(()=>C.merge(data(),data([{...note(),body:'conflict'},note(2)])),/Conflicting/);assert.equal(JSON.stringify(data()),original);
  assert.throws(()=>C.parse(JSON.stringify(data([note(),note()]))),/Duplicate/);
});
test('malformed imports rejected in full',()=>{
  const mutations=[
    d=>d.version=2,d=>d.extra=true,d=>d.notes=null,d=>d.notes[0].id='__proto__',d=>d.notes[0].id=[d.notes[0].id],d=>d.notes[0].source='javascript:alert(1)',
    d=>d.notes[0].source='https://user:secret@example.test/',d=>d.notes[0].source+='\u0023fragment',d=>d.notes[0].body='x'.repeat(4001),
    d=>d.notes[0].body='\ud800',d=>d.notes[0].created='yesterday',d=>d.notes[0].updated='2025-01-01T00:00:00.000Z',
    d=>d.notes[0].selector.start=-1,d=>d.notes[0].selector.end=9.5,d=>d.notes[0].selector.end=200001,
    d=>d.notes[0].selector.quote='',d=>d.notes[0].selector.quote='a\tb',d=>d.notes[0].selector.prefix='x'.repeat(33),
    d=>d.notes[0].selector.fingerprint='hash',d=>d.notes[0].selector.extra=1,d=>d.notes[0].extra=1,
    d=>d.notes[0].created='2026-02-31T00:00:00.000Z',d=>d.notes[0].selector=null,
  ];
  for(const mutate of mutations){const d=data();mutate(d);assert.throws(()=>C.parse(JSON.stringify(d)));}
  for(const raw of ['{','null','[]','42','{"version":1,"notes":[],"__proto__":{}}'])assert.throws(()=>C.parse(raw));
  assert.throws(()=>C.parse(' '.repeat(C.LIMIT.bytes+1)),/2 MiB/);
  assert.throws(()=>C.validate(data(Array.from({length:501},(_,i)=>note(i)))),/500/);
});
test('500-note capacity, 2 MiB limit and hostile text remain data',()=>{
  assert.equal(C.validate(data(Array.from({length:500},(_,i)=>note(i)))).notes.length,500);
  const large=Array.from({length:500},(_,i)=>({...note(i),body:'界'.repeat(4000)}));assert.throws(()=>C.validate(data(large)),/2 MiB/);
  const n={...note(),body:'<img src=x onerror=alert(1)>\n<script>evil()</script>'};assert.equal(C.parse(C.serialize(data([n]))).notes[0].body,n.body);
});
test('source identity retains query, removes fragment, disallows credentials and unsupported schemes',()=>{
  assert.equal(C.sourceURL('https://EXAMPLE.test/chat?a=1#turn'), 'https://example.test/chat?a=1');
  for(const s of ['file:///tmp/chat.html','chrome://settings','about:blank','https://me:pw@example.test/'])assert.throws(()=>C.sourceURL(s));
});
