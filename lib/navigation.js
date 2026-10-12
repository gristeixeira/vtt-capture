// A Hotmart usa Shadow DOM aberto. Controlos sem rótulo são identificados
// apenas quando aparecem em pares e na região imediatamente acima do título.
(function init(){
  function normalize(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
  function visible(el){if(!el||!el.getBoundingClientRect)return false;const b=el.getBoundingClientRect();return b.width>0&&b.height>0;}
  function collectRoots(root,seen=new Set()){
    if(!root || seen.has(root))return [];
    seen.add(root);let out=[root];
    for(const el of root.querySelectorAll('*')){if(el.shadowRoot)out.push(...collectRoots(el.shadowRoot,seen));}
    return out;
  }
  function findHeading(roots){for(const root of roots){for(const el of root.querySelectorAll('h1.text-2xl, h1[class*="text-2xl"], main h1'))if(visible(el))return el;}return null;}
  function findNext(){
    const roots=collectRoots(document);const h1=findHeading(roots);
    if(!h1)return {ok:false,reason:'Título da aula não encontrado; não é seguro avançar.'};
    const hb=h1.getBoundingClientRect();
    // Encontrar um par de botões numa barra de navegação sobre o vídeo.
    const container=h1.closest('section, main') || h1.parentElement?.parentElement;
    const candidates=[];
    for(const root of roots){
      for(const button of root.querySelectorAll('button,[role="button"]')){
        if(!visible(button) || button.disabled || button.getAttribute('aria-disabled')==='true')continue;
        const box=button.getBoundingClientRect();
        if(box.y>hb.y+10 || box.bottom<hb.top-190 || box.x<hb.left-30 || box.x>hb.left+1150)continue;
        const label=normalize([button.getAttribute('aria-label'),button.getAttribute('title'),button.getAttribute('data-testid'),button.textContent].filter(Boolean).join(' '));
        if(/\b(proximo|proxima|next|seguinte|avancar|skip.forward)\b/.test(label) && !/anterior|previous/.test(label))return {ok:true,element:button,mode:'rótulo de próxima aula'};
        candidates.push({button,box});
      }
    }
    // Os controlos no canto superior direito da Hotmart aparecem aos pares:
    // anterior à esquerda, seguinte à direita; nunca escolhemos isolados.
    candidates.sort((a,b)=>a.box.top-b.box.top || a.box.left-b.box.left);
    for(const right of candidates){
      if(right.box.width>95||right.box.height>95)continue;
      const left=candidates.find(x=>x!==right && x.box.left<right.box.left && right.box.left-x.box.right>=-4 && right.box.left-x.box.right<=40 && Math.abs(x.box.top-right.box.top)<=12 && Math.abs(x.box.height-right.box.height)<=12 && x.box.width<=95);
      if(left && right.box.top>=hb.top-155 && right.box.bottom<=hb.top+5)return {ok:true,element:right.button,mode:'par de botões de navegação'};
    }
    return {ok:false,reason:'Botão Próxima aula não identificado com segurança.'};
  }
  // Esta função é invocada exclusivamente por comandos de recuperação ou ação do utilizador.
  globalThis.fhadFindNextLesson = findNext;
})();
