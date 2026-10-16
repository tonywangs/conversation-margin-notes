(() => {
  'use strict';
  const C=MarginCore;
  const excluded=new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','INPUT','TEXTAREA','SELECT','BUTTON','IFRAME','CANVAS','SVG','MATH','OBJECT','EMBED']);
  function root() {
    const explicit=document.querySelectorAll('[data-margin-notes-root]');
    const roots=explicit.length?explicit:document.querySelectorAll('main');
    if (roots.length!==1) throw new Error('Unsupported page: provide exactly one conversation root (data-margin-notes-root or main).');
    return roots[0];
  }
  function index(element) {
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
    function walk(node) {
      if(++visited>C.LIMIT.nodes) throw new Error('Document exceeds 10,000 DOM nodes.');
      if(node.nodeType===Node.TEXT_NODE) {
        if(!node.data.isWellFormed()) throw new Error('Unsupported text: surrogate pairs must remain within one text node.');
        raw+=node.data.length;
        if(raw>C.LIMIT.raw) throw new Error('Document exceeds 400,000 raw text units.');
        let offset=0;
        for(const char of node.data) {push(char,{node,offset},{node,offset:offset+char.length});offset+=char.length;}
      } else if(node.nodeType===Node.ELEMENT_NODE) {
        const style=getComputedStyle(node);
        if(node.namespaceURI!=='http://www.w3.org/1999/xhtml' || excluded.has(node.tagName) || node.hidden || node.getAttribute('aria-hidden')==='true' || node.isContentEditable || style.display==='none' || style.visibility!=='visible' || node.shadowRoot) {skipped.push(node);return;}
        const block=!['inline','contents','inline-block'].includes(style.display);
        if(block || node.tagName==='BR') push(' ',null,null);
        for(const child of node.childNodes) walk(child);
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
