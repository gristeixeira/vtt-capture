// Read the primary lesson heading from open Shadow DOM, independent of the
// content script's messaging/debounce. Runs only on the user's Hotmart tab.
export function titleProbeExpression(){
  return `(() => {
    const seen=new Set(),roots=[];
    function scan(root){if(!root||seen.has(root)||typeof root.querySelectorAll!=='function')return;
      seen.add(root);roots.push(root);
      for(const el of root.querySelectorAll('*'))if(el.shadowRoot)scan(el.shadowRoot);
    }
    scan(document);
    const clean=x=>String(x||'').replace(/\\s+/g,' ').trim();
    const visible=el=>{try{return el.getClientRects().length>0 && getComputedStyle(el).visibility!=='hidden';}catch{return false;}};
    const selectors=['h1.text-2xl','h1[class*="text-2xl"]','[data-testid="lesson-title"]','main h1','h1'];
    for(const selector of selectors){for(const root of roots){for(const el of root.querySelectorAll(selector)){
      const title=clean(el.textContent);
      if(visible(el) && title.length>4 && title.length<181 && !/^(Hotmart|Biblioteca|Módulos)$/i.test(title))
        return {title,confidence:selector==='h1.text-2xl'||selector==='h1[class*="text-2xl"]'?'alta':'média',url:location.href};
    }}}
    return null;
  })()`;
}

// Only click Hotmart's explicit "Concluir" lesson button after video completion
// has been independently verified by the caller. Never seek, skip or complete
// another course item. Names and route are verified again within the page.
export function completionExpression(expectedUrl,expectedTitle){
  return `(() => {
    const wantedUrl=${JSON.stringify(expectedUrl)},wantedTitle=${JSON.stringify(expectedTitle)};
    const cleanUrl=s=>{try{const u=new URL(s);return u.origin+u.pathname;}catch{return '';}};
    const norm=s=>String(s||'').replace(/\\s+/g,' ').trim();
    if(cleanUrl(location.href)!==wantedUrl)return {ok:false,status:'A URL da aula mudou; não marcar como vista'};
    const seen=new Set(),roots=[];
    function scan(root){if(!root||seen.has(root)||typeof root.querySelectorAll!=='function')return;
      seen.add(root);roots.push(root);for(const el of root.querySelectorAll('*'))if(el.shadowRoot)scan(el.shadowRoot);
    }
    scan(document);
    const visible=el=>{try{return el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';}catch{return false;}};
    const heading=roots.flatMap(r=>Array.from(r.querySelectorAll('h1.text-2xl,h1[class*="text-2xl"],main h1'))).find(visible);
    const actual=norm(heading?.textContent);
    if(!actual||actual!==wantedTitle)return {ok:false,status:'Título ainda não confirmado; não marcar como vista',observedTitle:actual};
    const controls=roots.flatMap(r=>Array.from(r.querySelectorAll('button,[role="button"]'))).filter(visible);
    const text=el=>norm(el.innerText||el.textContent||el.getAttribute?.('aria-label'));
    const already=controls.find(el=>/^(conclu[ií]d[ao]|conclu[ií]do|conclu[ií]da)$/i.test(text(el)));
    if(already)return {ok:true,confirmed:true,status:'Aula já assinalada como concluída'};
    const candidate=controls.find(el=>/^concluir(?:\\s+aula)?$/i.test(text(el)) && !el.disabled && el.getAttribute('aria-disabled')!=='true');
    if(!candidate)return {ok:false,status:'Botão Concluir não localizado; mantém a aula para revisão'};
    try{candidate.click();return {ok:true,clicked:true,status:'Clique em Concluir enviado; a aguardar confirmação da Hotmart'};}
    catch{return {ok:false,status:'Falha ao clicar em Concluir'};}
  })()`;
}
