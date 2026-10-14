// Seleção específica para os controlos Hotmart identificados no DOM real.
// Confinada ao menu Qualidade, em vez de procurar texto ou clicar em menus arbitrários.
export function hotmartNativeQualityExpression(height) {
  if (!Number.isInteger(height) || height < 144 || height > 4320) throw Error('Resolução inválida');
  return `(async()=>{
    const height=${height};
    const seen=new Set(),roots=[];
    function visit(root){
      if(!root||seen.has(root)||typeof root.querySelectorAll!=='function')return;
      seen.add(root);roots.push(root);
      for(const el of root.querySelectorAll('*')){
        if(el.shadowRoot)visit(el.shadowRoot);
        if(el.tagName==='IFRAME'){try{visit(el.contentDocument);}catch{}}
      }
    }
    visit(document);
    const isActive=el=>el?.getAttribute('aria-checked')==='true'||
      el?.getAttribute('aria-selected')==='true'||
      el?.getAttribute('data-state')==='checked'||
      /(?:^|\\s)[^\\s]*active__[a-z0-9_-]+/i.test(String(el?.className||''));
    const visible=el=>{
      if(!el)return false;
      const r=el.getBoundingClientRect();
      if(r.width<4||r.height<4)return false;
      const style=el.ownerDocument?.defaultView?.getComputedStyle(el);
      return style?.display!=='none'&&style?.visibility!=='hidden'&&style?.opacity!=='0';
    };
    for(const root of roots){
      for(const player of root.querySelectorAll('[data-vjs-player="true"]')){
        if(!player.querySelector('video'))continue;
        const menus=player.querySelectorAll('[data-testid="floating-overlay"] [role="menu"]');
        for(const menu of menus){
          const buttons=[...menu.querySelectorAll('button[role="menuitem"][aria-label]')];
          const options=buttons.filter(el=>/^(auto|\\d{3,4}p)$/i.test((el.getAttribute('aria-label')||'').trim()));
          const target=options.find(el=>el.getAttribute('aria-label')?.trim().toLowerCase()===height+'p');
          if(!target||!visible(target)||!options.some(el=>(el.getAttribute('aria-label')||'').toLowerCase()==='auto'))continue;
          const selected=options.find(isActive);
          if(selected===target)return {found:true,attempted:false,alreadySelected:true,height,provider:'Hotmart (menu nativo)',status:height+'p já selecionado'};
          // Aciona exatamente o botão React da resolução, na janela do próprio player.
          // A confirmação é feita separadamente no menu, nunca pelo simples clique.
          try{target.click();return {found:true,attempted:true,applied:false,height,provider:'Hotmart (menu nativo)',previous:selected?.getAttribute('aria-label')||'Auto',status:'Clique nativo enviado ao botão '+height+'p; a verificar seleção'};}
          catch(e){return {found:true,attempted:false,applied:false,status:'Falha ao clicar no botão Hotmart: '+String(e?.message||e)};}
        }
      }
    }
    return {found:false,attempted:false,applied:false,status:'Menu nativo de qualidade Hotmart não encontrado'};
  })()`;
}
