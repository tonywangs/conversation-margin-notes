(() => {
  'use strict';
  if(globalThis.marginPanel) {globalThis.marginPanel.open();return;}
  const C=MarginCore,D=MarginDOM;
  const host=document.createElement('aside');host.id='conversation-margin-notes-panel';
  host.style.cssText='all:initial;position:fixed;inset:0 0 0 auto;width:min(390px,100vw);height:100dvh;z-index:2147483647;display:block;';
  const shadow=host.attachShadow({mode:'open'});
  const style=document.createElement('style');style.textContent=`
    :host {color-scheme:light} *{box-sizing:border-box} .panel{height:100%;overflow:auto;background:#faf8f2;color:#172a32;font:14px/1.5 system-ui,sans-serif;box-shadow:-5px 0 25px #152a3226;padding:20px}
    header{border-bottom:1px solid #ccd4d1;padding-bottom:16px;margin-bottom:16px} .eyebrow{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#526b68} h1{font-family:Georgia,serif;font-size:28px;font-weight:500;margin:4px 0} h2{font-size:16px;margin:0 0 10px} p{margin:8px 0} .muted{color:#516365;font-size:12px} .bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}
    button,select,input,textarea{font:inherit} button{border:1px solid #a8b8b4;border-radius:6px;background:#fffdf7;color:#172a32;padding:8px 10px;cursor:pointer} button.primary{background:#164f48;color:white;border-color:#164f48} button:disabled{opacity:.55;cursor:default} :focus-visible{outline:3px solid #d37c18;outline-offset:2px} textarea,input,select{width:100%;border:1px solid #9eafac;border-radius:5px;background:white;color:#172a32;padding:8px} textarea{min-height:110px;resize:vertical} label{display:block;font-weight:600;margin:10px 0 4px} [hidden]{display:none!important}
    #status{padding:9px 10px;border-left:3px solid #477e6f;background:#edf2ec;overflow-wrap:anywhere;min-height:40px} #status.error{border-color:#a42d25;background:#fff0ed} article{border-top:1px solid #ccd4d1;padding:16px 0;overflow-wrap:anywhere} blockquote{border-left:3px solid #d5a957;margin:8px 0;padding:4px 10px;color:#445557;white-space:pre-wrap;max-height:120px;overflow:auto} .body{white-space:pre-wrap;max-height:180px;overflow:auto}.tag{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#315e54}.tag.uncertain{color:#9a4a20}.source{font-size:11px;overflow-wrap:anywhere} #composer{border:1px solid #a9bcb5;padding:12px;border-radius:8px;margin:14px 0} footer{border-top:1px solid #ccd4d1;margin-top:18px;padding-top:10px} #file{font-size:12px} .close{margin-left:auto} .empty{padding:24px 0}
  `;shadow.append(style);
  const panel=document.createElement('section');panel.className='panel';panel.setAttribute('aria-label','Margin Notes');
  // Static trusted markup only. Notes, URLs and diagnostics use textContent.
  panel.innerHTML=`<header><div class="bar"><span class="eyebrow">Private · on this device</span><button id="close" class="close" aria-label="Close notes panel">×</button></div><h1>Margin Notes</h1><p class="muted">Keep a thought beside the passage that sparked it.</p></header>
    <div id="status" role="status" aria-live="polite" aria-atomic="true">Opening your notebook…</div>
    <div class="bar"><button id="add" class="primary">Annotate selection</button><button id="refresh">Refresh notes & anchors</button></div>
    <p class="muted">Select conversation text, then annotate. After a reload, activate the extension again.</p>
    <section id="composer" hidden aria-labelledby="composer-title"><h2 id="composer-title">New note</h2><blockquote id="draft-quote"></blockquote><label for="body">Your note</label><textarea id="body" maxlength="8000"></textarea><p id="draft-count" class="muted">Up to 4,000 characters.</p><div class="bar"><button id="save" class="primary">Save note</button><button id="cancel">Cancel draft</button></div></section>
    <label for="scope">Show notes</label><select id="scope"><option value="current">This source</option><option value="all">All sources</option></select>
    <label for="search">Find a note</label><input id="search" type="search" maxlength="200" placeholder="Search note or quotation">
    <p id="count" class="muted"></p><div id="list" aria-label="Notes"></div><nav class="bar" aria-label="Note pages"><button id="previous">Previous</button><span id="page" aria-live="polite"></span><button id="next">Next</button></nav>
    <footer><h2>Portable notebook</h2><button id="export">Export all notes</button><label for="file">Import JSON (up to 2 MiB)</label><input id="file" type="file" accept="application/json,.json"><p class="muted">Imports merge without overwriting. Export contains source URLs and note text. Keep a backup before removing the extension.</p></footer>`;
  shadow.append(panel);document.documentElement.append(host);
  const $=id=>shadow.getElementById(id);
  const highlightStyle=document.createElement('style');highlightStyle.textContent='::highlight(margin-notes){background:#f3d88c;color:inherit} ::highlight(margin-notes-active){background:#f0af51;color:inherit}';document.documentElement.append(highlightStyle);
  let state={revision:0,data:{version:1,notes:[]}},loaded=false,model=null,digest='',source='',page=0,draft=null,busy=false,epoch=0,observer=null,previousFocus=document.activeElement;
  function announce(text,error=false) {$('status').textContent=text;$('status').className=error?'error':'';}
  function clearHighlights() {CSS.highlights?.delete('margin-notes');CSS.highlights?.delete('margin-notes-active');}
  function invalidate() {epoch++;model=null;clearHighlights();announce('Page changed. Refresh anchors before selecting or navigating.');render();}
  function sameSource() {return source===C.sourceURL(location.href);}
  function statusFor(note) {
    if(note.source!==source) return {status:'source mismatch'};
    if(!model || !sameSource()) return {status:'refresh required'};
    return C.anchor(model.text,digest,note.selector);
  }
  function setBusy(value) {busy=value;for(const id of ['save','add','file','refresh','export']) $(id).disabled=value || (id==='export'&&!loaded);}
  async function rpc(message) {
    const response=await chrome.runtime.sendMessage(message);
    if(!response?.ok) throw new Error(response?.error||'Extension unavailable. Reactivate after reloading.');
    return response.value;
  }
  async function refresh() {
    if(busy)return;setBusy(true);
    try {
      state=await rpc({type:'read'});loaded=true;
      source=C.sourceURL(location.href);
      observer?.disconnect();clearHighlights();model=null;
      const element=D.root();
      observer=new MutationObserver(records=>{
        if(!element.isConnected || records.some(record=>element.contains(record.target) || (record.type==='attributes' && record.target.contains(element)))) invalidate();
      });
      observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
      const generation=++epoch,newModel=D.index(element),newDigest=await C.fingerprint(newModel.text);
      if(generation!==epoch) throw new Error('Page changed during indexing. Refresh anchors again.');
      model=newModel;digest=newDigest;
      announce(`Ready. ${state.data.notes.length} saved notes. Select a passage to begin.`);
    } catch(e) {model=null;clearHighlights();announce(e.message,true);}
    finally {setBusy(false);render();}
  }
  function render() {
    $('list').replaceChildren();clearHighlights();
    const search=$('search').value.toLocaleLowerCase();
    const filtered=state.data.notes.filter(n=>($('scope').value==='all'||n.source===source)&&(!search||`${n.body}\n${n.selector.quote}`.toLocaleLowerCase().includes(search)));
    const pages=Math.max(1,Math.ceil(filtered.length/C.LIMIT.rows));page=Math.min(page,pages-1);
    const visible=filtered.slice(page*C.LIMIT.rows,(page+1)*C.LIMIT.rows),ranges=[];
    $('count').textContent=`${filtered.length} shown · ${state.data.notes.length} total · ${state.data.notes.filter(n=>n.source!==source).length} on other sources`;
    $('page').textContent=`${page+1} / ${pages}`;$('previous').disabled=page===0;$('next').disabled=page===pages-1;
    if(!visible.length) {const p=document.createElement('p');p.className='empty';p.textContent='No notes here yet. Select a passage above, or show all sources.';$('list').append(p);}
    for(const note of visible) {
      const resolved=statusFor(note),article=document.createElement('article');article.dataset.noteId=note.id;
      const tag=document.createElement('span');tag.className='tag'+(resolved.start===undefined?' uncertain':'');tag.textContent=resolved.status;article.append(tag);
      const quote=document.createElement('blockquote');quote.textContent=note.selector.quote;article.append(quote);
      const body=document.createElement('div');body.className='body';body.textContent=note.body||'(No note text)';article.append(body);
      if(note.source!==source) {const url=document.createElement('p');url.className='source';url.textContent=note.source;article.append(url);}
      const bar=document.createElement('div');bar.className='bar';
      const button=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.addEventListener('click',fn);bar.append(b);return b;};
      const jump=button('Go to passage',()=>navigate(note));jump.disabled=resolved.start===undefined;
      button('Edit',()=>{if(busy)return;if(draft){announce('Save or cancel the current draft first.',true);return;}draft={id:note.id,quote:note.selector.quote};showDraft(note.body);});
      button('Delete',()=>{if(busy)return;if(draft?.id===note.id){announce('Save or cancel this draft before deleting.',true);return;}const b=bar.querySelector('[data-confirm]');if(b){b.remove();return;}const confirm=button('Confirm delete',()=>mutate({type:'delete',id:note.id},'Note deleted.'));confirm.dataset.confirm='true';confirm.focus();});
      article.append(bar);$('list').append(article);
      if(resolved.start!==undefined) try {ranges.push(D.range(model,resolved.start,resolved.end));} catch { /* Observer will invalidate. */ }
    }
    if(ranges.length && CSS.highlights) CSS.highlights.set('margin-notes',new Highlight(...ranges));
  }
  function showDraft(body) {$('composer').hidden=false;$('composer-title').textContent=draft.id?'Edit note':'New note';$('draft-quote').textContent=draft.quote;$('body').value=body;$('body').focus();}
  function cancelDraft() {draft=null;$('composer').hidden=true;$('body').value='';$('add').focus();}
  async function capture() {
    if(busy)return;
    try {
      if(draft) throw new Error('Save or cancel the current draft first.');
      if(!loaded || !model || !sameSource()) throw new Error('Refresh anchors before selecting text.');
      const selected=getSelection();const range=selected.rangeCount?selected.getRangeAt(0).cloneRange():null;
      const generation=epoch,current=D.index(D.root()),currentDigest=await C.fingerprint(current.text);
      if(!model || generation!==epoch || currentDigest!==digest) {invalidate();throw new Error('Page changed. Refresh anchors before selecting text.');}
      const {start,end}=D.selection(current,range);
      const selector=C.quoteAt(model.text,start,end,digest);
      draft={source,selector,quote:selector.quote};showDraft('');announce('Write a note, then save. Nothing is stored until you save.');
    } catch(e) {announce(e.message,true);}
  }
  async function mutate(operation,message) {
    if(busy || !loaded)return;setBusy(true);
    try {
      state=await rpc({...operation,revision:state.revision});
      if(operation.type==='create'||operation.type==='edit')cancelDraft();
      if(operation.type==='import') {
        const mismatch=state.data.notes.filter(n=>n.source!==source).length;
        message=`Imported ${state.added}; skipped ${state.skipped} identical notes. ${mismatch} source mismatch notes available under All sources.`;
      }
      render();announce(message);
    } catch(e) {announce(`Save failed; existing notes and draft preserved. ${e.message}`,true);}
    finally {setBusy(false);}
  }
  async function navigate(note) {
    try {
      if(!model||!sameSource()) throw new Error('Refresh anchors first.');
      // Reindex at navigation time to catch CSS changes and mutations before observer delivery.
      const current=D.index(D.root()),hash=await C.fingerprint(current.text);
      if(!model || hash!==digest) {invalidate();throw new Error('Page changed. Refresh anchors before navigating.');}
      const resolved=C.anchor(current.text,hash,note.selector);
      if(resolved.start===undefined) throw new Error(`Passage is ${resolved.status}; no attachment made.`);
      const range=D.range(current,resolved.start,resolved.end);
      CSS.highlights?.set('margin-notes-active',new Highlight(range));
      range.startContainer.parentElement.scrollIntoView({block:'center',behavior:'instant'});
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      announce(`Passage selected (${resolved.status}). Close the panel to see the full page.`);
    } catch(e) {announce(e.message,true);}
  }
  $('close').onclick=()=>{host.hidden=true;host.style.display='none';clearHighlights();previousFocus?.focus?.();};
  $('add').addEventListener('mousedown',event=>event.preventDefault());$('add').onclick=capture;
  $('refresh').onclick=refresh;$('cancel').onclick=cancelDraft;
  $('body').oninput=()=>{$('draft-count').textContent=`${C.size($('body').value)} / 4,000 characters`;$('save').disabled=C.size($('body').value)>C.LIMIT.body;};
  $('save').onclick=()=>{
    if(!draft)return;const body=$('body').value;
    if(draft.id) mutate({type:'edit',id:draft.id,body},'Note updated.');
    else {const now=new Date().toISOString();mutate({type:'create',note:{id:crypto.randomUUID(),source:draft.source,body,created:now,updated:now,selector:draft.selector}},'Note saved on this device.');}
  };
  $('scope').onchange=$('search').oninput=()=>{page=0;render();};
  $('previous').onclick=()=>{page--;render();$('next').focus();};$('next').onclick=()=>{page++;render();$('previous').focus();};
  $('export').onclick=()=>{
    try {if(!loaded)throw new Error('Refresh notes first.');const text=C.serialize(state.data);if(C.bytes(text)>C.LIMIT.bytes)throw new Error('Export exceeds 2 MiB.');const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='margin-notes-v1.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);announce(`Exported ${state.data.notes.length} notes. Keep the JSON file private.`);}catch(e){announce(e.message,true);}
  };
  $('file').onchange=async()=>{
    const file=$('file').files[0];if(!file)return;
    try {if(file.size>C.LIMIT.bytes)throw new Error('Import exceeds 2 MiB.');const text=await file.text();C.parse(text);await mutate({type:'import',text},'Imported.');}
    catch(e){announce(`Import failed; existing notes preserved. ${e.message}`,true);}
    finally {$('file').value='';}
  };
  shadow.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();$('close').click();}});
  globalThis.marginPanel={open(){host.hidden=false;host.style.display='block';previousFocus=document.activeElement;$('add').focus();refresh();}};
  $('add').focus();refresh();
})();
