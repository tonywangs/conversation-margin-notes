'use strict';
const initial=document.querySelector('main').cloneNode(true),quote=document.querySelector('#target').textContent;
let sequence=0,stream=null;
const paragraph=text=>{const p=document.createElement('p');p.textContent=text;return p;};
function stop(){clearInterval(stream);stream=null;}
document.querySelector('#controls').addEventListener('click',event=>{
  const action=event.target.dataset.action;if(!action)return;
  const root=document.querySelector('main'),target=root.querySelector('#target');
  if(action==='append')root.append(paragraph(`Message ${++sequence}: another observation.`));
  if(action==='edit'&&target)target.textContent='Keep the revised conclusion.';
  if(action==='duplicate')root.append(paragraph(quote));
  if(action==='move'&&target)root.append(target);
  if(action==='remove'&&target)target.remove();
  if(action==='replace'){stop();root.replaceWith(root.cloneNode(true));}
  if(action==='incomplete')root.setAttribute('data-margin-notes-incomplete',String(root.getAttribute('data-margin-notes-incomplete')!=='true'));
  if(action==='restore'){stop();root.replaceWith(initial.cloneNode(true));sequence=0;}
  if(action==='stream'){
    if(stream)stop();
    else {const p=paragraph('Streaming');root.append(p);let ticks=0;stream=setInterval(()=>{p.append(` ${++ticks}`);if(ticks===80){stop();document.querySelector('#activity').textContent='Stream finished. Anchors can settle.';}},80);}
  }
  document.querySelector('#activity').textContent=stream?'Streaming for up to 6.4 seconds; click Stream / stop to finish.':`Applied: ${action}.`;
});
