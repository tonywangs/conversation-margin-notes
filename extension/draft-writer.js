/* One coalescing writer per editor. No unload-time durability assumption. */
(() => {
  'use strict';
  function create(record,{rpc,changed=()=>{},stats={writes:0,failures:0,acknowledgments:0}}) {
    const editor={record,body:record.body,ackBody:record.version?record.body:null,pending:null,timer:null,error:'',stopping:false,editedAt:performance.now()};
    function notify(){changed(editor);}
    async function flush() {
      clearTimeout(editor.timer);editor.timer=null;
      if(editor.pending)return editor.pending;
      if(editor.stopping || editor.ackBody===editor.body)return !editor.error;
      const work=async()=>{
        while(!editor.stopping && editor.ackBody!==editor.body) {
          const snapshot={...editor.record,body:editor.body},started=performance.now(),editedAt=editor.editedAt;stats.writes++;
          try {
            const result=await rpc({type:'draft-put',draft:snapshot});
            editor.record=result;editor.ackBody=snapshot.body;editor.error='';stats.acknowledgments++;
            stats.lastWriteMs=performance.now()-started;stats.lastInputToAckMs=performance.now()-editedAt;
            stats.totalWriteMs=(stats.totalWriteMs||0)+stats.lastWriteMs;stats.maxWriteMs=Math.max(stats.maxWriteMs||0,stats.lastWriteMs);
          } catch(e) {editor.error=e.message;clearTimeout(editor.timer);editor.timer=null;stats.failures++;return false;}
          finally {notify();}
        }
        return true;
      };
      // Defer work one microtask so synchronous test boundaries see pending too.
      editor.pending=Promise.resolve().then(work);notify();
      try{return await editor.pending;}finally{editor.pending=null;notify();}
    }
    function edit(body) {
      if(editor.stopping)return;
      editor.body=body;editor.editedAt=performance.now();editor.error='';clearTimeout(editor.timer);
      editor.timer=setTimeout(flush,MarginDrafts.LIMIT.debounce);notify();
    }
    async function stop() {
      editor.stopping=true;clearTimeout(editor.timer);editor.timer=null;
      if(editor.pending)await editor.pending;
    }
    return Object.assign(editor,{flush,edit,stop});
  }
  globalThis.MarginDraftWriter=Object.freeze({create});
})();
