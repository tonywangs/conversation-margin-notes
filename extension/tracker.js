/* Bounded live-document controller. No storage writes and no selection/focus edits. */
(() => {
  'use strict';
  const LIMIT=Object.freeze({quietMs:150,windowMs:10000,attempts:8,records:1000,batches:120});
  function create({ignore=[],onChange}) {
    let epoch=0,timer=null,running=false,stopped=false,paused=false,windowStart=performance.now(),attempts=0,batches=0;
    let changedAt=0,lastChange=0;
    let snapshot={status:'pending',message:'Opening anchors…',model:null,digest:'',source:''};
    const stats={batches:0,records:0,inspectedRecords:0,maxInspectedRecords:0,maxBatchRecords:0,indexAttempts:0,commits:0,discarded:0,failures:0,notifications:0,maxVisitedNodes:0,maxDiscoveryNodes:0,totalIndexMs:0,maxIndexMs:0,lastUpdateMs:0,lastQuietToReadyMs:0,maxUpdateMs:0};
    function emit(status,message,extra={}) {
      snapshot={...snapshot,status,message,model:null,digest:'',...extra};
      stats.notifications++;onChange(snapshot);
    }
    function windowBudget() {
      if(performance.now()-windowStart>=LIMIT.windowMs) {windowStart=performance.now();attempts=0;batches=0;}
    }
    function incomplete(message,halt=false) {
      clearTimeout(timer);timer=null;epoch++;paused=halt;
      emit('incomplete',`Incomplete: ${message} Use Refresh notes & anchors. No attachment made.`);
    }
    function pending() {
      epoch++;lastChange=performance.now();
      if(snapshot.status!=='pending') {changedAt=lastChange;emit('pending','Page changed. Anchors pending while the document updates.');}
      clearTimeout(timer);
      if(!paused && !stopped) timer=setTimeout(recompute,LIMIT.quietMs);
    }
    function recordsReceived(records) {
      if(!records.length || stopped)return;
      stats.batches++;stats.records+=records.length;stats.maxBatchRecords=Math.max(stats.maxBatchRecords,records.length);
      if(paused)return; // One constant-time check until an explicit manual retry.
      if(records.length>LIMIT.records) {incomplete('Mutation batch exceeds 1,000 records.',true);return;}
      let changed=false,inspected=0;
      for(const record of records) {
        inspected++;
        if(!ignore.some(node=>record.target===node || node.contains(record.target))) {changed=true;break;}
      }
      stats.inspectedRecords+=inspected;stats.maxInspectedRecords=Math.max(stats.maxInspectedRecords,inspected);
      if(!changed)return;
      windowBudget();
      if(++batches>LIMIT.batches) {incomplete('Mutation activity exceeds 120 batches in 10 seconds.',true);return;}
      pending();
    }
    const observer=new MutationObserver(recordsReceived);
    // Observing Document survives body/container replacement and catches root
    // ambiguity, ancestor visibility changes, and stylesheet DOM edits.
    observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true});
    async function recompute() {
      clearTimeout(timer);timer=null;
      if(stopped || paused)return;
      if(running) {timer=setTimeout(recompute,LIMIT.quietMs);return;}
      recordsReceived(observer.takeRecords());
      if(paused)return;
      windowBudget();
      if(++attempts>LIMIT.attempts) {incomplete('Indexing budget exceeds 8 attempts in 10 seconds.',true);return;}
      running=true;stats.indexAttempts++;
      const generation=epoch,started=performance.now();
      try {
        const source=MarginCore.sourceURL(location.href),element=MarginDOM.root(),model=MarginDOM.index(element);
        stats.maxDiscoveryNodes=Math.max(stats.maxDiscoveryNodes,MarginDOM.root.visited);
        stats.maxVisitedNodes=Math.max(stats.maxVisitedNodes,model.visited);
        const digest=await MarginCore.fingerprint(model.text);
        recordsReceived(observer.takeRecords());
        if(generation!==epoch || stopped || source!==MarginCore.sourceURL(location.href)) {stats.discarded++;if(generation===epoch&&!stopped)pending();return;}
        stats.commits++;
        stats.lastUpdateMs=changedAt?performance.now()-changedAt:performance.now()-started;
        stats.lastQuietToReadyMs=lastChange?performance.now()-lastChange:performance.now()-started;
        stats.maxUpdateMs=Math.max(stats.maxUpdateMs,stats.lastUpdateMs);
        clearTimeout(timer);timer=null;
        emit('ready',`Ready. Anchors updated for the current document.`,{model,digest,source});
      } catch(error) {
        if(generation===epoch&&!stopped) {stats.failures++;incomplete(error.message);}
      } finally {
        const elapsed=performance.now()-started;stats.totalIndexMs+=elapsed;stats.maxIndexMs=Math.max(stats.maxIndexMs,elapsed);running=false;
      }
    }
    return Object.freeze({
      refresh() {
        paused=false;windowStart=performance.now();attempts=0;batches=0;
        pending();return recompute();
      },
      invalidate:pending,
      // Call before committing async capture/navigation results. MutationObserver
      // delivery is asynchronous; queued records must be consumed first.
      current() {recordsReceived(observer.takeRecords());return {epoch,...snapshot};},
      diagnostics() {return {status:snapshot.status,epoch,paused,limits:LIMIT,...stats};},
      stop() {stopped=true;epoch++;clearTimeout(timer);observer.disconnect();}
    });
  }
  globalThis.MarginTracker=Object.freeze({create,LIMIT});
})();
