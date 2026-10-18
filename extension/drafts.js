/* Draft storage schema and optimistic concurrency. Saved-note schema is untouched. */
(() => {
  'use strict';
  const C=MarginCore, LIMIT=Object.freeze({records:32,bytes:1048576,body:8000,debounce:300});
  const fail=text=>{throw new Error(text);};
  const uuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
  const integer=value=>Number.isSafeInteger(value) && value>=0;
  function record(input) {
    if(!input || Object.keys(input).sort().join('|')!==['id','version','note','baseRevision','baseNote','body'].sort().join('|'))fail('Invalid draft fields.');
    if(!uuid(input.id) || !integer(input.version) || !integer(input.baseRevision))fail('Invalid draft identity or revision.');
    const note=C.validateNote(input.note),baseNote=input.baseNote===null?null:C.validateNote(input.baseNote);
    if(note.body!=='')fail('Draft template must have an empty body.');
    if(baseNote && JSON.stringify({...baseNote,body:''})!==JSON.stringify(note))fail('Draft base identity mismatch.');
    if(typeof input.body!=='string' || input.body.length>LIMIT.body*2 || C.size(input.body)>LIMIT.body || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input.body))fail('Draft text exceeds 8,000 characters or contains invalid Unicode.');
    return {id:input.id,version:input.version,note,baseRevision:input.baseRevision,baseNote,body:input.body};
  }
  function envelope(value={version:1,entries:[]}) {
    if(!value || Object.keys(value).sort().join('|')!=='entries|version' || value.version!==1 || !Array.isArray(value.entries))fail('Invalid draft storage. Export recovery data before repairing storage.');
    if(value.entries.length>LIMIT.records)fail('Draft capacity exceeded (32 drafts). Export and discard an older draft.');
    const entries=value.entries.map(record);
    if(entries.length>LIMIT.records || new Set(entries.map(d=>d.id)).size!==entries.length)fail('Draft capacity exceeded (32 drafts). Export and discard an older draft.');
    const result={version:1,entries};
    if(C.bytes(JSON.stringify(result))>LIMIT.bytes)fail('Draft capacity exceeded (1 MiB). Export and discard an older draft.');
    return result;
  }
  function replace(store,input) {
    const next=record(input),old=store.entries.find(d=>d.id===next.id);
    if((old?.version??0)!==next.version || (!old && next.version!==0))fail('Draft changed or was discarded in another tab. Export your current text; refresh recovery drafts.');
    if(old && JSON.stringify({...old,version:0,body:''})!==JSON.stringify({...next,version:0,body:''}))fail('Original draft identity cannot change.');
    next.version++;
    return envelope({version:1,entries:[...store.entries.filter(d=>d.id!==next.id),next]});
  }
  function remove(store,id,version) {
    const old=store.entries.find(d=>d.id===id);
    if(!old || old.version!==version)fail('Draft changed or was discarded in another tab. Refresh recovery drafts before discarding.');
    return envelope({version:1,entries:store.entries.filter(d=>d.id!==id)});
  }
  function assessment(draft,state) {
    const saved=state.data.notes.find(n=>n.id===draft.note.id);
    const sameIdentity=saved && saved.source===draft.note.source && saved.created===draft.note.created && JSON.stringify(saved.selector)===JSON.stringify(draft.note.selector);
    if(sameIdentity && saved.body===draft.body && (!draft.baseNote || JSON.stringify(saved)!==JSON.stringify(draft.baseNote)))return 'saved';
    if(draft.baseRevision!==state.revision || (draft.baseNote ? JSON.stringify(saved)!==JSON.stringify(draft.baseNote) : !!saved))return 'conflict';
    return 'ready';
  }
  globalThis.MarginDrafts=Object.freeze({LIMIT,record,envelope,replace,remove,assessment});
})();
