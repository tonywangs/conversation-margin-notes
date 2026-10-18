(() => {
  let generation=0;
  const quote='Shared 🌙 café café 日本語 👩‍👩‍👧‍👦 passage.';
  function render(url,marked=true) {
    const root=document.createElement('main');
    if(marked)root.dataset.marginNotesSource=new URL(url,location.href).href;
    const who=new URL(url,location.href).searchParams.get('conversation')||'A';
    const title=document.createElement('h2');title.textContent=`Conversation ${who}`;
    const target=document.createElement('p');target.id='target';target.textContent=quote;
    const tail=document.createElement('p');tail.textContent=`End of ${who}.`;
    root.append(title,target,tail);document.querySelector('main').replaceWith(root);
  }
  function go(who,{replace=false,delay=0,marked=true}={}) {
    const ticket=++generation,url=new URL(location.href);url.hash='';url.search=`?conversation=${who}`;
    document.querySelector('main').setAttribute('aria-busy','true');
    history[replace?'replaceState':'pushState']({},'',url);
    setTimeout(()=>{if(ticket===generation)render(url,marked);},delay);
  }
  document.querySelector('#a').onclick=()=>go('A');
  document.querySelector('#b').onclick=()=>go('B',{delay:700});
  document.querySelector('#replace').onclick=()=>go('B',{replace:true});
  document.querySelector('#back').onclick=()=>history.back();
  document.querySelector('#forward').onclick=()=>history.forward();
  document.querySelector('#unmarked').onclick=()=>go('unmarked',{marked:false});
  document.querySelector('#hash').onclick=()=>{location.hash='/conversation/C';};
  addEventListener('popstate',()=>{++generation;render(location.href);});
  if(!location.search)history.replaceState({},'','?conversation=A');
  render(location.href);
})();
