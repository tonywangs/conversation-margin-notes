/* This document is not web-accessible. Private text never enters a source tab. */
'use strict';
const C=MarginCore,PD=MarginDrafts,$=id=>document.getElementById(id);
const tabId=Number(new URL(location.href).searchParams.get('tab'));
let state=null,snapshot=null,writer=null,busy=false,page=0,polling=false;
const announce=(text,error=false)=>{$('status').textContent=text;$('status').className=error?'error':'';};
async function rpc(message) {const reply=await chrome.runtime.sendMessage(message);if(!reply?.ok)throw Error(reply?.error||'Extension unavailable.');return reply.value;}
async function source(action,extra={}) {const reply=await chrome.tabs.sendMessage(tabId,{type:'source',action,...extra});if(!reply?.ok)throw Error(reply?.error||'Source unavailable.');return reply.value;}
function ready(){return snapshot?.status==='ready' && snapshot.source===C.sourceURL(snapshot.url) && !new URL(snapshot.url).hash;}
function persistence(){
  $('persistence').textContent=!writer?'':writer.error?`Draft persistence failed: ${writer.error}. Export your draft.`:writer.ackBody===writer.body?'Draft persisted on this device. Not yet a saved note.':'Pending edits — wait for Draft persisted before closing.';
}
function controls(){
  $('save').disabled=busy||!writer||!ready()||writer.record.note.source!==snapshot.source||C.size(writer.body)>C.LIMIT.body;
  $('body').readOnly=busy||!ready()||writer?.record.note.source!==snapshot?.source;
  for(const id of ['capture','refresh','confirm','cancel','import'])$(id).disabled=busy;
  $('capture').disabled ||= !!writer||!ready();$('export').disabled=!state||busy;
  $('export-draft').disabled=!writer;
  persistence();
}
function accept(value){snapshot=value;$('source').textContent=value.source||value.url||'Source unavailable';$('anchors').textContent=value.message;$('confirm').hidden=!value.canConfirm;render();controls();}
async function update(action='snapshot'){accept(await source(action));}
async function run(task){if(busy)return;busy=true;controls();try{await task();}catch(e){announce(e.message,true);}finally{busy=false;controls();}}
function button(parent,label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=()=>run(fn);parent.append(b);return b;}
function text(parent,tag,content,className=''){const e=document.createElement(tag);e.textContent=content;e.className=className;parent.append(e);return e;}
function download(value,name){const url=URL.createObjectURL(new Blob([value],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function render(){
  if(!state)return;
  const filtered=state.data.notes.filter(n=>($('scope').value==='all'||n.source===snapshot?.source)&&`${n.body} ${n.selector.quote}`.toLocaleLowerCase().includes($('search').value.toLocaleLowerCase()));
  const pages=Math.max(1,Math.ceil(filtered.length/C.LIMIT.rows));page=Math.min(page,pages-1);
  $('page').textContent=`${page+1} / ${pages}`;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
  // Keep controls mounted when a source poll has not changed the anchor state.
  const key=JSON.stringify([state.revision,snapshot?.status,snapshot?.source,snapshot?.digest,page,$('scope').value,$('search').value]);
  if($('notes').dataset.key===key)return;$('notes').dataset.key=key;$('notes').replaceChildren();
  for(const note of filtered.slice(page*C.LIMIT.rows,(page+1)*C.LIMIT.rows)){
    const article=document.createElement('article');article.dataset.noteId=note.id;
    const anchor=note.source!==snapshot?.source?{status:'source mismatch'}:ready()?C.anchor(snapshot.text,snapshot.digest,note.selector):{status:snapshot?.status||'unresolved'};
    text(article,'span',anchor.status,'tag');text(article,'blockquote',note.selector.quote);text(article,'div',note.body,'body');text(article,'p',note.source,'source');
    const bar=text(article,'div','','bar');
    const jump=button(bar,'Go to passage',async()=>{const result=await source('jump',{source:note.source,selector:note.selector});await chrome.tabs.update(tabId,{active:true});const tab=await chrome.tabs.get(tabId);await chrome.windows.update(tab.windowId,{focused:true});announce(`Passage selected (${result.status}).`);});jump.disabled=anchor.start===undefined;
    button(bar,'Edit',async()=>{if(writer)throw Error('Save or discard the current draft first.');begin(note,note);});
    button(bar,'Delete',async()=>{if(writer)throw Error('Save or discard the current draft first.');if(!bar.querySelector('[data-confirm]')){const confirm=button(bar,'Confirm delete',async()=>{await mutate({type:'delete',id:note.id});announce('Note deleted.');});confirm.dataset.confirm='true';confirm.focus();}});
    $('notes').append(article);
  }
  if(!filtered.length)text($('notes'),'p','No notes here yet. Select a passage in the original tab.');
}
function begin(note,baseNote,record=null){
  record??={id:crypto.randomUUID(),version:0,note:{...note,body:''},baseRevision:state.revision,baseNote,body:note.body};
  writer=MarginDraftWriter.create(record,{rpc,changed:persistence});
  $('composer').hidden=false;$('composer-title').textContent=baseNote?'Edit note':'New note';$('quote').textContent=note.selector.quote;$('body').value=record.body;
  if(!record.version)writer.edit(record.body);controls();$('body').focus();
}
async function clear(){await writer?.stop();writer=null;$('composer').hidden=true;$('body').value='';controls();}
async function recovery(){
  const records=(await rpc({type:'draft-list'})).entries;$('drafts').replaceChildren();
  for(const record of records){const row=text($('drafts'),'div','');text(row,'p',record.note.source,'source');text(row,'p',record.body.slice(0,160),'body');
    button(row,'Recover persisted draft',async()=>{if(writer)throw Error('Save or discard the current draft first.');await update();state=await rpc({type:'read'});if(!ready()||record.note.source!==snapshot.source)throw Error('Return to the original source to recover this draft.');const current=(await rpc({type:'draft-list'})).entries.find(d=>d.id===record.id);if(!current)throw Error('Draft was removed in another window.');begin(current.note,current.baseNote,current);announce(PD.assessment(current,state)==='ready'?'Draft recovered. Review before saving.':'Draft conflicts with saved notes. Export it before discarding; no existing note will be overwritten.');});
    button(row,'Export recovery',async()=>download(JSON.stringify({format:'margin-notes-draft-recovery',version:1,draft:record},null,2),'margin-notes-draft-recovery.json'));
    button(row,'Discard persisted draft',async()=>{if(writer?.record.id===record.id)throw Error('Use Discard draft in the editor.');await rpc({type:'draft-discard',id:record.id,version:record.version});await recovery();});
  }
}
async function mutate(operation){
  await update();if(!ready())throw Error('Source unresolved. Refresh before saving.');
  state=await rpc({...operation,revision:state.revision,contextSource:snapshot.source,contextURL:snapshot.url});render();
}
$('capture').onclick=()=>run(async()=>{
  if(writer)throw Error('Save or discard the current draft first.');
  const selected=await source('capture');await update();if(!ready()||selected.url!==snapshot.url)throw Error('Source changed. Select again.');
  const now=new Date().toISOString();begin({id:crypto.randomUUID(),source:selected.source,selector:selected.selector,body:'',created:now,updated:now},null);announce('Write your note in this private extension window.');
});
$('body').oninput=()=>{writer?.edit($('body').value);controls();};
$('save').onclick=()=>run(async()=>{
  if(!writer)return;const current=writer;
  if(!await current.flush())throw Error(current.error||'Draft was not persisted.');
  await update();if(current.record.note.source!==snapshot.source)throw Error('Source changed. Draft retained on its original source.');
  const operation=current.record.baseNote?{type:'edit',id:current.record.note.id,body:current.body}:{type:'create',note:{...current.record.note,body:current.body}};
  await mutate({...operation,draftId:current.record.id,draftVersion:current.record.version});const retained=state.draftRetained;await clear();await recovery();announce((operation.type==='create'?'Note saved on this device.':'Note updated.')+(retained?' Draft cleanup failed; recovery copy retained.':''));
});
$('cancel').onclick=()=>run(async()=>{if(!writer)return;await writer.stop();try{await rpc({type:'draft-discard',id:writer.record.id,version:writer.record.version});}catch(e){writer.stopping=false;throw e;}await clear();await recovery();announce('Draft discarded.');});
$('export-draft').onclick=()=>{if(writer)download(JSON.stringify({format:'margin-notes-draft-recovery',version:1,draft:{...writer.record,body:writer.body}},null,2),'margin-notes-draft-recovery.json');};
async function refresh(){
  snapshot=null;controls();await rpc({type:'connect-source'});await update('refresh');state=await rpc({type:'read'});await recovery();render();announce('Ready. Select a passage in the original tab.');
}
$('refresh').onclick=()=>run(refresh);
$('confirm').onclick=()=>run(async()=>{await update('confirm');announce('Source confirmation requested.');});
$('export').onclick=()=>run(async()=>{state=await rpc({type:'read'});download(C.serialize(state.data),'margin-notes-v1.json');announce('Notebook exported. Keep the file private.');});
$('import').onchange=()=>run(async()=>{const file=$('import').files[0];if(!file)return;try{if(file.size>C.LIMIT.bytes)throw Error('Import exceeds 2 MiB.');const value=await file.text();C.parse(value);await mutate({type:'import',text:value});announce('Notebook imported without overwriting conflicts.');}finally{$('import').value='';}});
$('scope').onchange=$('search').oninput=()=>{page=0;render();};$('previous').onclick=()=>{page--;render();};$('next').onclick=()=>{page++;render();};
// Poll only while this editor exists. A reload disconnects the source agent;
// explicitly refreshing reconnects under the existing activeTab grant.
setInterval(async()=>{if(polling||busy)return;polling=true;try{await update();}catch{if(snapshot?.status!=='unresolved')accept({status:'unresolved',message:'Source disconnected or reloaded. Use Refresh source & notes.',source:'',text:'',url:''});}finally{polling=false;}},1000);
addEventListener('beforeunload',event=>{if(writer && writer.ackBody!==writer.body){event.preventDefault();event.returnValue='';}});
run(refresh);
