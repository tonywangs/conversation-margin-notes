/* Bounded live-document controller. No storage writes and no selection/focus edits. */
(() => {
  'use strict';
  const LIMIT=Object.freeze({quietMs:150,windowMs:10000,attempts:8,records:1000,batches:120});
  function create({ignore=[],onChange}) {
    let epoch=0,timer=null,running=false,stopped=false,paused=false,windowStart=performance.now(),attempts=0,batches=0;
    let changedAt=0,lastChange=0,session=0,lastURL=location.href,inTransit=false,needsConfirmation=false;
    const navigationAvailable=!!globalThis.navigation?.currentEntry;
    let snapshot={status:'pending',message:'Opening anchors…',model:null,digest:'',source:''};
    const stats={navigationEvents:0,batches:0,records:0,inspectedRecords:0,maxInspectedRecords:0,maxBatchRecords:0,indexAttempts:0,commits:0,discarded:0,failures:0,notifications:0,maxVisitedNodes:0,maxDiscoveryNodes:0,totalIndexMs:0,maxIndexMs:0,lastUpdateMs:0,lastQuietToReadyMs:0,maxUpdateMs:0};
    function emit(status,message,extra={}) {
      snapshot={...snapshot,status,message,model:null,digest:'',session,canConfirm:false,...extra};
      stats.notifications++;onChange(snapshot);
    }
    function windowBudget() {
      if(performance.now()-windowStart>=LIMIT.windowMs) {windowStart=performance.now();attempts=0;batches=0;}
    }
    function incomplete(message,halt=false) {
      clearTimeout(timer);timer=null;epoch++;paused=halt;
      emit('incomplete',`Incomplete: ${message} Use Refresh notes & anchors. No attachment made.`);
    }
    function pending(clearSource=false) {
      epoch++;lastChange=performance.now();
      if(snapshot.status!=='pending' || (clearSource && snapshot.source)) {changedAt=lastChange;emit('pending','Page changed. Anchors pending while the document updates.',clearSource?{source:''}:{});}
      clearTimeout(timer);
      if(!paused && !stopped) timer=setTimeout(recompute,LIMIT.quietMs);
    }
    function transition(waitForCommit=false) {
      stats.navigationEvents++;session++;lastURL=location.href;inTransit=waitForCommit;needsConfirmation=true;
      pending(true);
    }
    function checkURL() {if(lastURL!==location.href)transition(false);}
    function identity(element) {
      if(!navigationAvailable)throw new Error('Navigation API unavailable. This browser cannot safely track same-tab identity.');
      const source=MarginCore.sourceURL(location.href);
      const reject=(message,canConfirm=false)=>{needsConfirmation=true;const error=new Error(message);error.identity=true;error.canConfirm=canConfirm;throw error;};
      if(inTransit)reject('Navigation has not committed. Refresh after the page finishes.');
      // Version 1 identities are fragment-free. A hash can also be a router key;
      // never silently merge those conversations into a legacy source.
      if(new URL(location.href).hash)reject('Fragment navigation is unresolved. Hash-routed conversations are unsupported; return to a fragment-free URL.');
      const declared=element.getAttribute('data-margin-notes-source');
      // Once a page supplies identity evidence, removing it is not permission to
      // fall back to the initial unmarked-document compatibility path.
      if(declared!==null)needsConfirmation=true;
      if(declared!==null && declared!==source)reject('Rendered conversation and URL disagree. Wait for the destination, then Refresh notes & anchors.');
      if(needsConfirmation && declared===null)reject(`Unresolved conversation: ${source}. Verify that the displayed content belongs to this URL, then choose Confirm displayed conversation.`,true);
      return source;
    }
    const onNavigate=event=>{if(event.isTrusted && !event.downloadRequest)transition(true);};
    const onEntry=event=>{if(event.isTrusted)transition(false);};
    const onFailure=event=>{if(event.isTrusted){inTransit=false;pending(true);}};
    globalThis.navigation?.addEventListener('navigate',onNavigate);
    globalThis.navigation?.addEventListener('currententrychange',onEntry);
    globalThis.navigation?.addEventListener('navigateerror',onFailure);
    // Defensive URL checks supplement the native History API notifications.
    addEventListener('popstate',checkURL);addEventListener('hashchange',checkURL);
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
      checkURL();recordsReceived(observer.takeRecords());
      if(paused)return;
      windowBudget();
      if(++attempts>LIMIT.attempts) {incomplete('Indexing budget exceeds 8 attempts in 10 seconds.',true);return;}
      running=true;stats.indexAttempts++;
      const generation=epoch,started=performance.now();
      try {
        const element=MarginDOM.root(),source=identity(element),model=MarginDOM.index(element);
        stats.maxDiscoveryNodes=Math.max(stats.maxDiscoveryNodes,MarginDOM.root.visited);
        stats.maxVisitedNodes=Math.max(stats.maxVisitedNodes,model.visited);
        const digest=await MarginCore.fingerprint(model.text);
        checkURL();recordsReceived(observer.takeRecords());
        if(generation!==epoch || stopped || source!==MarginCore.sourceURL(location.href)) {stats.discarded++;if(generation===epoch&&!stopped)pending();return;}
        stats.commits++;
        stats.lastUpdateMs=changedAt?performance.now()-changedAt:performance.now()-started;
        stats.lastQuietToReadyMs=lastChange?performance.now()-lastChange:performance.now()-started;
        stats.maxUpdateMs=Math.max(stats.maxUpdateMs,stats.lastUpdateMs);
        clearTimeout(timer);timer=null;
        emit('ready',`Ready. Anchors updated for the current document.`,{model,digest,source});
      } catch(error) {
        if(generation===epoch&&!stopped) {
          stats.failures++;
          if(error.identity) {
            if(snapshot.source)session++;
            emit('unresolved',error.message,{source:'',canConfirm:!!error.canConfirm});
          } else incomplete(error.message);
        }
      } finally {
        const elapsed=performance.now()-started;stats.totalIndexMs+=elapsed;stats.maxIndexMs=Math.max(stats.maxIndexMs,elapsed);running=false;
      }
    }
    return Object.freeze({
      refresh() {
        paused=false;windowStart=performance.now();attempts=0;batches=0;
        pending();return recompute();
      },
      confirm() {
        checkURL();recordsReceived(observer.takeRecords());
        if(snapshot.status!=='unresolved' || !snapshot.canConfirm)return false;
        // Confirmation applies only to this URL/session, never overrides a marker,
        // fragment, incomplete document, or unsupported source.
        const element=MarginDOM.root();
        if(element.hasAttribute('data-margin-notes-source') || new URL(location.href).hash)return false;
        MarginCore.sourceURL(location.href);MarginDOM.index(element);
        needsConfirmation=false;pending();return true;
      },
      invalidate:pending,
      // Call before committing async capture/navigation results. MutationObserver
      // delivery is asynchronous; queued records must be consumed first.
      current() {checkURL();recordsReceived(observer.takeRecords());return {epoch,...snapshot,session};},
      diagnostics() {return {status:snapshot.status,epoch,session,source:snapshot.source,needsConfirmation,navigationAvailable,paused,limits:LIMIT,...stats};},
      stop() {
        stopped=true;epoch++;clearTimeout(timer);observer.disconnect();
        globalThis.navigation?.removeEventListener('navigate',onNavigate);
        globalThis.navigation?.removeEventListener('currententrychange',onEntry);
        globalThis.navigation?.removeEventListener('navigateerror',onFailure);
        removeEventListener('popstate',checkURL);removeEventListener('hashchange',checkURL);
      }
    });
  }
  globalThis.MarginTracker=Object.freeze({create,LIMIT});
})();
