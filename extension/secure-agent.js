/* Page-side adapter: public transcript/selection only, never note or draft text. */
(() => {
  if(globalThis.marginSecureAgent)return;
  const C=MarginCore,D=MarginDOM;
  const tracker=MarginTracker.create({onChange(){CSS.highlights?.delete('margin-notes-active');}});
  function snapshot() {
    const s=tracker.current();
    return {status:s.status,message:s.message,source:s.source,url:location.href,
      session:s.session,epoch:s.epoch,digest:s.digest,text:s.model?.text||'',canConfirm:s.canConfirm};
  }
  async function command(message) {
    if(message.action==='snapshot')return snapshot();
    if(message.action==='refresh'){await tracker.refresh();return snapshot();}
    if(message.action==='confirm'){tracker.confirm();await tracker.refresh();return snapshot();}
    const before=tracker.current(),url=location.href;
    if(before.status!=='ready')throw Error(before.message);
    const selected=getSelection(),range=selected.rangeCount?selected.getRangeAt(0).cloneRange():null;
    const model=D.index(D.root()),digest=await C.fingerprint(model.text),after=tracker.current();
    if(url!==location.href || before.epoch!==after.epoch || before.session!==after.session || digest!==after.digest)
      throw Error('Page changed. Refresh the source before retrying.');
    if(message.action==='capture') {
      const {start,end}=D.selection(model,range);
      return {source:after.source,url,selector:C.quoteAt(model.text,start,end,digest)};
    }
    if(message.action==='jump') {
      if(message.source!==after.source)throw Error('Source mismatch; no attachment.');
      const anchor=C.anchor(model.text,digest,message.selector);
      if(anchor.start===undefined)throw Error(`Passage is ${anchor.status}; no attachment.`);
      const target=D.range(model,anchor.start,anchor.end);
      CSS.highlights?.set('margin-notes-active',new Highlight(target));
      target.startContainer.parentElement.scrollIntoView({block:'center'});
      selected.removeAllRanges();selected.addRange(target);
      return {status:anchor.status};
    }
    throw Error('Unknown source operation.');
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('secure.html')+'?') || message.type!=='source')return false;
    // No DOM events or page-world messages are accepted as commands.
    command(message).then(value=>respond({ok:true,value}),error=>respond({ok:false,error:error.message}));
    return true;
  });
  globalThis.marginSecureAgent=true;
})();
