/* Shared pure logic. No DOM, network, or storage side effects. */
(() => {
  'use strict';
  const LIMIT = Object.freeze({document:200000, raw:400000, nodes:10000, quote:2000, body:4000, notes:500, bytes:2097152, rows:20, context:32});
  const cp = s => Array.from(s);
  const size = s => cp(s).length;
  const bytes = s => new TextEncoder().encode(s).length;
  const normalize = s => s.replace(/\s+/gu, ' ').trim();
  const fail = message => { throw new Error(message); };
  const keys = (v, expected) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).sort().join('|') !== [...expected].sort().join('|')) fail('Unexpected record fields.');
  };
  function sourceURL(value) {
    if (typeof value !== 'string' || value.length > 4096) fail('Invalid source URL.');
    let u; try { u = new URL(value); } catch { fail('Invalid source URL.'); }
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) fail('Only HTTP(S) sources without credentials are supported.');
    u.hash = ''; return u.href;
  }
  async function fingerprint(text) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');
  }
  function quoteAt(text, start, end, digest) {
    const chars = cp(text);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > chars.length || end <= start || end-start > LIMIT.quote) fail('Select 1–2,000 supported characters.');
    return {quote:chars.slice(start,end).join(''), prefix:chars.slice(Math.max(0,start-LIMIT.context),start).join(''), suffix:chars.slice(end,end+LIMIT.context).join(''), start, end, fingerprint:digest};
  }
  function anchor(text, digest, selector) {
    if (digest === selector.fingerprint) {
      const actual = cp(text).slice(selector.start,selector.end).join('');
      return actual === selector.quote ? {status:'exact',start:selector.start,end:selector.end} : {status:'missing'};
    }
    const first = text.indexOf(selector.quote);
    if (first < 0) return {status:'missing'};
    // Overlapping occurrences count as ambiguity. Never use old position to rank.
    if (text.indexOf(selector.quote, first + 1) >= 0) return {status:'ambiguous'};
    const start = size(text.slice(0,first));
    return {status:'uniquely reanchored',start,end:start+size(selector.quote)};
  }
  function validString(value, max, name, empty=true) {
    if (typeof value !== 'string' || value.length > max*2 || size(value)>max || (!empty && !value.length) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) fail(`Invalid ${name}.`);
  }
  function validateNote(note) {
    keys(note,['id','source','body','created','updated','selector']);
    if (typeof note.id!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(note.id)) fail('Invalid note ID.');
    if (sourceURL(note.source)!==note.source) fail('Source URL must be canonical and fragment-free.');
    validString(note.body,LIMIT.body,'note text');
    for (const k of ['created','updated']) if (typeof note[k] !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(note[k]) || !Number.isFinite(Date.parse(note[k])) || new Date(note[k]).toISOString()!==note[k]) fail('Invalid timestamp.');
    if (note.updated<note.created) fail('Update predates creation.');
    const s = note.selector;
    keys(s,['quote','prefix','suffix','start','end','fingerprint']);
    validString(s.quote,LIMIT.quote,'quote',false);
    validString(s.prefix,LIMIT.context,'prefix'); validString(s.suffix,LIMIT.context,'suffix');
    if (s.quote.replace(/\s+/gu,' ') !== s.quote || !s.quote.trim()) fail('Quote must be normalized text.');
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start<0 || s.end>LIMIT.document || s.end-s.start!==size(s.quote)) fail('Invalid code-point offsets.');
    if (typeof s.fingerprint!=='string' || !/^[0-9a-f]{64}$/.test(s.fingerprint)) fail('Invalid source fingerprint.');
    return {id:note.id,source:note.source,body:note.body,created:note.created,updated:note.updated,selector:{quote:s.quote,prefix:s.prefix,suffix:s.suffix,start:s.start,end:s.end,fingerprint:s.fingerprint}};
  }
  function validate(data) {
    keys(data,['version','notes']);
    if (data.version!==1) fail('Unsupported export version.');
    if (!Array.isArray(data.notes) || data.notes.length>LIMIT.notes) fail('At most 500 notes are allowed.');
    const notes = data.notes.map(validateNote).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    if (new Set(notes.map(n=>n.id)).size!==notes.length) fail('Duplicate note ID in input.');
    const result = {version:1,notes};
    if (bytes(JSON.stringify(result,null,2)+'\n')>LIMIT.bytes) fail('Notes exceed the 2 MiB storage limit.');
    return result;
  }
  function parse(input) {
    if (typeof input!=='string' || bytes(input)>LIMIT.bytes) fail('Import exceeds 2 MiB.');
    let data; try {data=JSON.parse(input);} catch {fail('Import is not valid JSON.');}
    return validate(data);
  }
  function serialize(data) { return JSON.stringify(validate(data),null,2)+'\n'; }
  function merge(existing, incoming) {
    const a=validate(existing), b=validate(incoming), map=new Map(a.notes.map(n=>[n.id,n]));
    let skipped=0;
    for (const n of b.notes) {
      if (map.has(n.id)) {
        if (JSON.stringify(map.get(n.id))!==JSON.stringify(n)) fail('Conflicting note ID; no notes imported.');
        skipped++;
      } else map.set(n.id,n);
    }
    return {data:validate({version:1,notes:[...map.values()]}),skipped,added:b.notes.length-skipped};
  }
  globalThis.MarginCore=Object.freeze({LIMIT,cp,size,bytes,normalize,sourceURL,fingerprint,quoteAt,anchor,validateNote,validate,parse,serialize,merge});
})();
