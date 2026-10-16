(() => {
  'use strict';
  const C=MarginCore;
  const excluded=new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','INPUT','TEXTAREA','SELECT','BUTTON','IFRAME','CANVAS','SVG','MATH','OBJECT','EMBED']);
  function root() {
    // Bound discovery too, including nodes outside the conversation. Never collect
    // an unbounded selector result on a large/hostile page.
    const explicit=[],fallback=[];
    const walker=document.createTreeWalker(document,NodeFilter.SHOW_ALL);
    let node,visited=0;
    while((node=walker.nextNode())) {
      if(++visited>20000) throw new Error('Root discovery exceeds 20,000 document nodes.');
      if(node.nodeType!==1) continue;
      if(node.hasAttribute('data-margin-notes-root') && explicit.length<2) explicit.push(node);
      if(node.tagName==='MAIN' && fallback.length<2) fallback.push(node);
    }
    root.visited=visited;
    const roots=explicit.length?explicit:fallback;
    if (roots.length!==1) throw new Error('Unsupported page: provide exactly one conversation root (data-margin-notes-root or main).');
    return roots[0];
  }
  function index(element) {
    if(element.namespaceURI!=='http://www.w3.org/1999/xhtml' || excluded.has(element.tagName) || element.isContentEditable || element.shadowRoot) throw new Error('Unsupported conversation root: use visible, non-editable HTML light DOM.');
    let ancestors=0;
    for(let ancestor=element;ancestor;ancestor=ancestor.parentElement) {
      if(++ancestors>128) throw new Error('Conversation root exceeds 128 ancestor levels.');
      const style=getComputedStyle(ancestor);
      if(ancestor.hidden || ancestor.getAttribute('aria-hidden')==='true' || style.display==='none' || style.visibility!=='visible') throw new Error('Conversation root is hidden; document is incomplete.');
      if(ancestor.getAttribute('aria-busy')==='true' || ancestor.getAttribute('data-margin-notes-incomplete')==='true') throw new Error('Conversation is marked incomplete or busy.');
    }
    let visited=0,raw=0,pending=null;
    const chars=[],map=[],skipped=[];
    function push(char,a,b) {
      if (/\s/u.test(char)) {
        if (!pending) pending={a,b}; else if(b) pending.b=b;
        return;
      }
      if(pending && chars.length) {
        chars.push(' ');map.push({a:pending.a||map.at(-1).b,b:pending.b||a});
      }
      pending=null; chars.push(char);map.push({a,b});
      if(chars.length>C.LIMIT.document) throw new Error('Document exceeds 200,000 normalized characters.');
    }
    function walk(node,depth=0) {
      if(++visited>C.LIMIT.nodes) throw new Error('Document exceeds 10,000 DOM nodes.');
      if(depth>128) throw new Error('Document exceeds 128 nested levels.');
      if(node.nodeType===Node.TEXT_NODE) {
        raw+=node.data.length;
        if(raw>C.LIMIT.raw) throw new Error('Document exceeds 400,000 raw text units.');
        if(!node.data.isWellFormed()) throw new Error('Unsupported text: surrogate pairs must remain within one text node.');
        let offset=0;
        for(const char of node.data) {push(char,{node,offset},{node,offset:offset+char.length});offset+=char.length;}
      } else if(node.nodeType===Node.ELEMENT_NODE) {
        if(node.getAttribute('aria-busy')==='true' || node.getAttribute('data-margin-notes-incomplete')==='true') throw new Error('Conversation is marked incomplete or busy.');
        const style=getComputedStyle(node);
        if(node.namespaceURI!=='http://www.w3.org/1999/xhtml' || excluded.has(node.tagName) || node.hidden || node.getAttribute('aria-hidden')==='true' || node.isContentEditable || style.display==='none' || style.visibility!=='visible' || node.shadowRoot) {skipped.push(node);return;}
        const block=!['inline','contents','inline-block'].includes(style.display);
        if(block || node.tagName==='BR') push(' ',null,null);
        for(const child of node.childNodes) walk(child,depth+1);
        if(block) push(' ',null,null);
      }
    }
    walk(element);
    return {element,text:chars.join(''),map,skipped,visited,raw};
  }
  function selection(model, range) {
    if(!range || range.collapsed || range.startContainer.nodeType!==3 || range.endContainer.nodeType!==3 || !model.element.contains(range.startContainer) || !model.element.contains(range.endContainer)) throw new Error('Select text inside the supported conversation. Use text endpoints, not entire elements.');
    for(const node of model.skipped) if(range.intersectsNode(node)) throw new Error('Selection crosses unsupported or hidden content.');
    let start=-1,end=-1;
    for(let i=0;i<model.map.length;i++) {
      const p=model.map[i];
      if(p.a.node===range.startContainer && p.a.offset===range.startOffset) start=i;
      if(p.b.node===range.endContainer && p.b.offset===range.endOffset) end=i+1;
    }
    if(start<0 || end<=start || end-start>C.LIMIT.quote) throw new Error('Select 1–2,000 characters at supported text boundaries (not within collapsed whitespace or an emoji).');
    return {start,end};
  }
  function range(model,start,end) {
    const a=model.map[start]?.a,b=model.map[end-1]?.b;
    if(!a || !b || !a.node.isConnected || !b.node.isConnected) throw new Error('Passage changed. Refresh anchors.');
    const r=document.createRange();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);return r;
  }
  globalThis.MarginDOM=Object.freeze({root,index,selection,range});
})();
