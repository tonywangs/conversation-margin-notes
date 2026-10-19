/* Test-only adapter for historical in-page UI regression checks.
 * Never packaged in extension/. The production worker accepts private notebook
 * operations only from secure.html and never injects the old panel. */
importScripts('production-worker.js');
chrome.action.onClicked.removeListener(openSecure);
chrome.action.onClicked.addListener(async tab=>{
  try {
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['core.js','drafts.js','draft-writer.js','dom.js','tracker.js','panel.js']});
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
  }catch(e){await chrome.action.setTitle({tabId:tab.id,title:`Cannot open Margin Notes: ${e.message}`});}
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id||!sender.tab||sender.frameId!==0||!sender.url?.startsWith('http://127.0.0.1:'))return false;
  const work=queue.then(()=>dispatch(message,sender));queue=work.catch(()=>{});
  work.then(value=>respond({ok:true,value}),error=>respond({ok:false,error:String(error.message||error)}));return true;
});
