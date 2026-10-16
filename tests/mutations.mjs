// Expected statuses and positions follow the construction of each mutation, not
// production search output. DOM canonical text is checked against a separate oracle.
export async function mutationSuite(page) {
  return page.evaluate(async()=>{
    const C=MarginCore,D=MarginDOM;
    let seed=0x5eedc0de;
    const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
    const results=[],assert=(ok,message)=>{if(!ok)throw new Error(message);};
    const kinds=['inserted','moved','duplicate','whitespace','unicode','removed','markup'];
    for(let trial=0;trial<40;trial++) for(const kind of kinds) {
      const token=random().toString(36),quote=`Target 🌙 café ${token}.`;
      const before=`Ada Prompt ${token}. Bea `,after=` Ada Tail ${token}.`;
      document.body.innerHTML='<main><p id="before"></p><p id="target"></p><p id="tail"></p></main>';
      document.querySelector('#before').textContent=before.trimEnd();document.querySelector('#target').textContent=quote;document.querySelector('#tail').textContent=after.trim();
      const root=document.querySelector('main'),original=before+quote+after,baseline=D.index(root);
      assert(baseline.text===original,`baseline normalization ${kind} ${trial}`);
      const hash=await C.fingerprint(original),start=Array.from(before).length;
      const selector=C.quoteAt(original,start,start+Array.from(quote).length,hash);
      let expectedText=original,expectedStatus='exact',expectedStart=start;
      if(kind==='inserted'||kind==='unicode') {
        const prefix=kind==='unicode'?`👩‍👩‍👧‍👦 日本語 café ${token}.`:`A new observation ${token}.`;
        const node=document.createElement('p');node.textContent=prefix;root.prepend(node);
        expectedText=prefix+' '+original;expectedStatus='uniquely reanchored';expectedStart=Array.from(prefix+' '+before).length;
      } else if(kind==='moved') {
        root.append(document.querySelector('#target'));
        expectedText=before.trimEnd()+after+' '+quote;expectedStatus='uniquely reanchored';expectedStart=Array.from(before.trimEnd()+after+' ').length;
      } else if(kind==='duplicate') {
        // Copy context as well: position/context must not resolve this duplication.
        const p=document.createElement('p');p.textContent=original;root.append(p);
        expectedText=original+' '+original;expectedStatus='ambiguous';expectedStart=undefined;
      } else if(kind==='whitespace') {
        for(const p of root.children) p.textContent=' \n'+p.textContent.replaceAll(' ','\t\n\u00a0  ')+'\t ';
      } else if(kind==='removed') {
        document.querySelector('#target').remove();expectedText=before.trimEnd()+after;expectedStatus='missing';expectedStart=undefined;
      } else if(kind==='markup') {
        const target=document.querySelector('#target');target.replaceChildren();
        for(const ch of quote) {const span=document.createElement(random()%2?'strong':'em');span.textContent=ch;target.append(span);}
      }
      const changed=D.index(root),changedHash=await C.fingerprint(changed.text),result=C.anchor(changed.text,changedHash,selector);
      assert(changed.text===expectedText,`text oracle ${kind} ${trial}: ${changed.text}`);
      assert(result.status===expectedStatus,`status oracle ${kind} ${trial}: ${result.status}`);
      assert(result.start===expectedStart,`position oracle ${kind} ${trial}: ${result.start} vs ${expectedStart}`);
      if(expectedStart!==undefined) {
        const range=D.range(changed,result.start,result.end);
        assert(C.normalize(range.toString())===quote,`DOM range ${kind} ${trial}`);
        const selected=D.selection(changed,range);assert(selected.start===result.start && selected.end===result.end,`selection roundtrip ${kind} ${trial}`);
      }
      results.push({trial,kind,token,status:result.status});
    }
    // Independent negative DOM cases and code point roundtrips.
    const negative=[];
    const reject=(fn,name)=>{let rejected=false;try{fn();}catch{rejected=true;}assert(rejected,name);negative.push(name);};
    document.body.innerHTML='<main><p id="a">🌙x</p><p hidden>secret</p><p id="b">end</p></main>';
    let root=document.querySelector('main'),model=D.index(root);assert(model.text==='🌙x end','hidden text excluded');
    let r=document.createRange();r.setStart(document.querySelector('#a').firstChild,1);r.setEnd(document.querySelector('#a').firstChild,2);reject(()=>D.selection(model,r),'split surrogate rejected');
    r=document.createRange();r.setStart(document.querySelector('#a').firstChild,0);r.setEnd(document.querySelector('#b').firstChild,3);reject(()=>D.selection(model,r),'hidden crossing rejected');
    root.textContent='\ud800';reject(()=>D.index(root),'unpaired surrogate rejected');
    root.textContent='x'.repeat(200001);reject(()=>D.index(root),'normalized document limit');
    root.textContent=' '.repeat(400001);reject(()=>D.index(root),'raw document limit');
    root.replaceChildren(...Array.from({length:10001},()=>document.createElement('span')));reject(()=>D.index(root),'DOM node limit');
    root.textContent='x'.repeat(2001);model=D.index(root);r=document.createRange();r.setStart(root.firstChild,0);r.setEnd(root.firstChild,2001);reject(()=>D.selection(model,r),'selection limit');
    document.body.innerHTML='<main><p>before <input value="secret"><span contenteditable>edit</span><canvas>canvas</canvas><svg><text>vector</text></svg><span style="display:none">hidden</span><span id="shadow"></span>after</p></main>';
    document.querySelector('#shadow').attachShadow({mode:'open'}).textContent='shadow';
    assert(D.index(document.querySelector('main')).text==='before after','unsupported nodes excluded');negative.push('unsupported content excluded');
    document.body.innerHTML='<main>one</main><main>two</main>';reject(()=>D.root(),'multiple roots');
    document.body.innerHTML='<p>no root</p>';reject(()=>D.root(),'missing root');
    return {seed:'0x5eedc0de',cases:results.length,counts:Object.fromEntries(kinds.map(k=>[k,results.filter(r=>r.kind===k).length])),statuses:Object.fromEntries(['exact','uniquely reanchored','ambiguous','missing'].map(s=>[s,results.filter(r=>r.status===s).length])),negative,results};
  });
}
