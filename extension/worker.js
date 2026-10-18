importScripts('core.js','drafts.js');
const C = MarginCore, D = MarginDrafts;
let queue = Promise.resolve();
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function read() {
  const {notebook} = await chrome.storage.local.get('notebook');
  if (!notebook) return {revision:0,data:{version:1,notes:[]}};
  if (!Number.isSafeInteger(notebook.revision) || notebook.revision<0) throw new Error('Stored revision is invalid.');
  return {revision:notebook.revision,data:C.validate(notebook.data)};
}
async function readDrafts() {
  const {drafts}=await chrome.storage.local.get('drafts');
  return D.envelope(drafts);
}
async function dispatch(message,sender) {
  if(message.type==='draft-list')return readDrafts();
  if(message.type==='draft-put') {
    const drafts=D.replace(await readDrafts(),message.draft);
    await chrome.storage.local.set({drafts});
    return drafts.entries.find(d=>d.id===message.draft.id);
  }
  if(message.type==='draft-discard') {
    const current=await readDrafts();
    if(!current.entries.some(d=>d.id===message.id))return {discarded:true};
    const drafts=D.remove(current,message.id,message.version);
    await chrome.storage.local.set({drafts});return {discarded:true};
  }
  const state=await read();
  if (message.type==='read') return state;
  if (message.revision!==state.revision) throw new Error('Notes changed in another tab. Refresh notes before retrying; your draft is retained.');
  // The operation carries its immutable source. Never infer a destination source
  // from a late tab lookup. The lookup only rejects a request that has moved on.
  if(C.sourceURL(message.contextSource)!==message.contextSource || C.sourceURL(message.contextURL)!==message.contextSource || new URL(message.contextURL).hash)throw new Error('Unresolved operation source.');
  const tab=await chrome.tabs.get(sender.tab.id);
  if(tab.url!==message.contextURL)throw new Error('Page navigated before the operation was accepted. Draft retained.');
  let draftStore, savedDraft;
  if(message.type==='create' || message.type==='edit') {
    draftStore=await readDrafts();savedDraft=draftStore.entries.find(d=>d.id===message.draftId);
    if(!savedDraft || savedDraft.version!==message.draftVersion)throw new Error('Draft changed or was discarded in another tab. Export your text and refresh recovery drafts.');
    if(D.assessment(savedDraft,state)!=='ready')throw new Error('Notes changed in another tab since this draft began. Export it or start a separate note; refreshing cannot overwrite newer notes.');
    if(message.type==='create' ? savedDraft.baseNote!==null || JSON.stringify(C.validateNote(message.note))!==JSON.stringify({...savedDraft.note,body:savedDraft.body}) : !savedDraft.baseNote || message.id!==savedDraft.note.id || message.body!==savedDraft.body)throw new Error('Save does not match persisted draft.');
  }
  let data, details={};
  if (message.type==='create') {
    const note=C.validateNote(message.note);
    if(note.source!==message.contextSource)throw new Error('Note belongs to another source.');
    if (state.data.notes.some(n=>n.id===note.id)) throw new Error('Note ID already exists.');
    data=C.validate({version:1,notes:[...state.data.notes,note]});
  } else if (message.type==='edit') {
    const old=state.data.notes.find(n=>n.id===message.id);
    if (!old) throw new Error('Note no longer exists.');
    if(old.source!==message.contextSource)throw new Error('Note belongs to another source.');
    const updated=C.validateNote({...old,body:message.body,updated:new Date().toISOString()});
    data=C.validate({version:1,notes:state.data.notes.map(n=>n.id===old.id?updated:n)});
  } else if (message.type==='delete') {
    const old=state.data.notes.find(n=>n.id===message.id);
    if (!old) throw new Error('Note no longer exists.');
    if(old.source!==message.contextSource)throw new Error('Note belongs to another source.');
    data={version:1,notes:state.data.notes.filter(n=>n.id!==message.id)};
  } else if (message.type==='import') {
    const merged=C.merge(state.data,C.parse(message.text)); data=merged.data;
    details={added:merged.added,skipped:merged.skipped};
  } else throw new Error('Unknown operation.');
  // One atomic key replacement; failed writes never update the in-memory/UI state.
  const next={revision:state.revision+1,data};
  await chrome.storage.local.set({notebook:next});
  if(savedDraft) {
    try {await chrome.storage.local.set({drafts:D.remove(draftStore,savedDraft.id,savedDraft.version)});}
    catch {details.draftRetained=true;}
  }
  return {...next,...details};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (sender.id!==chrome.runtime.id || !sender.tab || sender.frameId!==0) return false;
  const work=queue.then(()=>dispatch(message,sender));
  queue=work.catch(()=>{});
  work.then(value=>respond({ok:true,value}),error=>respond({ok:false,error:String(error.message||error)}));
  return true;
});
chrome.action.onClicked.addListener(async tab=>{
  try {
    C.sourceURL(tab.url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['core.js','drafts.js','draft-writer.js','dom.js','tracker.js','panel.js']});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
  } catch (e) {
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.action.setTitle({tabId:tab.id,title:`Cannot open Margin Notes: ${e.message}`});
  }
});
