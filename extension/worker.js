importScripts('core.js');
const C = MarginCore;
let queue = Promise.resolve();
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function read() {
  const {notebook} = await chrome.storage.local.get('notebook');
  if (!notebook) return {revision:0,data:{version:1,notes:[]}};
  if (!Number.isSafeInteger(notebook.revision) || notebook.revision<0) throw new Error('Stored revision is invalid.');
  return {revision:notebook.revision,data:C.validate(notebook.data)};
}
async function dispatch(message) {
  const state=await read();
  if (message.type==='read') return state;
  if (message.revision!==state.revision) throw new Error('Notes changed in another tab. Refresh notes before retrying; your draft is retained.');
  let data, details={};
  if (message.type==='create') {
    const note=C.validateNote(message.note);
    if (state.data.notes.some(n=>n.id===note.id)) throw new Error('Note ID already exists.');
    data=C.validate({version:1,notes:[...state.data.notes,note]});
  } else if (message.type==='edit') {
    const old=state.data.notes.find(n=>n.id===message.id);
    if (!old) throw new Error('Note no longer exists.');
    const updated=C.validateNote({...old,body:message.body,updated:new Date().toISOString()});
    data=C.validate({version:1,notes:state.data.notes.map(n=>n.id===old.id?updated:n)});
  } else if (message.type==='delete') {
    if (!state.data.notes.some(n=>n.id===message.id)) throw new Error('Note no longer exists.');
    data={version:1,notes:state.data.notes.filter(n=>n.id!==message.id)};
  } else if (message.type==='import') {
    const merged=C.merge(state.data,C.parse(message.text)); data=merged.data;
    details={added:merged.added,skipped:merged.skipped};
  } else throw new Error('Unknown operation.');
  // One atomic key replacement; failed writes never update the in-memory/UI state.
  const next={revision:state.revision+1,data};
  await chrome.storage.local.set({notebook:next});
  return {...next,...details};
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if (sender.id!==chrome.runtime.id || !sender.tab || sender.frameId!==0) return false;
  const work=queue.then(()=>dispatch(message));
  queue=work.catch(()=>{});
  work.then(value=>respond({ok:true,value}),error=>respond({ok:false,error:String(error.message||error)}));
  return true;
});
chrome.action.onClicked.addListener(async tab=>{
  try {
    C.sourceURL(tab.url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['core.js','dom.js','panel.js']});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
  } catch (e) {
    await chrome.action.setBadgeText({tabId:tab.id,text:'!'});
    await chrome.action.setTitle({tabId:tab.id,title:`Cannot open Margin Notes: ${e.message}`});
  }
});
