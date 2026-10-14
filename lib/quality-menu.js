// Fallback para players que expõem níveis de qualidade no menu (Hotmart Player),
// mas não expõem instâncias públicas hls.js/video.js/JW Player.
// Não faz pedidos de rede, não altera fontes do vídeo e não toca nas legendas.
export function qualityMenuExpression(mode='min', relativeToTab=false) {
  if (!['min','restore','target','retry-target','verify','focus-target','dismiss'].includes(mode)) throw new Error('Modo de qualidade inválido.');
  return `(async () => {
    const mode=${JSON.stringify(mode)};
    const relativeToTab=${Boolean(relativeToTab)};
    const storeKey=Symbol.for('fhad.vtt.qualityMenuBackup.v1');
    const backups=globalThis[storeKey]||(globalThis[storeKey]=new WeakMap());
    const failureKey=Symbol.for('fhad.vtt.qualityMenuUnsafe.v078');
    const failures=globalThis[failureKey]||(globalThis[failureKey]=new WeakMap());
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const plain=s=>String(s||'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/\\s+/g,' ').trim();
    const roots=[], videos=[], visited=new Set();
    function collect(root){
      if (!root||visited.has(root)||typeof root.querySelectorAll!=='function')return;
      visited.add(root);roots.push(root);
      for(const v of root.querySelectorAll('video'))videos.push({video:v,root});
      for(const el of root.querySelectorAll('*')){
        if(el.shadowRoot)collect(el.shadowRoot);
        if(el.tagName==='IFRAME'){try{collect(el.contentDocument);}catch{}}
      }
    }
    collect(document);
    const active=videos.map(x=>({...x,score:(x.video.paused?0:20)+(x.video.readyState>1?8:0)+(x.video.duration>0?5:0)})).sort((a,b)=>b.score-a.score)[0];
    if(!active)return {found:false,applied:false,status:'Player não encontrado para controlar o menu de qualidade'};
    const video=active.video, root=active.root;
    const rectOf=el=>{try{return el.getBoundingClientRect();}catch{return null;}};
    const vr=rectOf(video);
    const viable=el=>{
      if(!el||el===video)return false;
      const r=rectOf(el);
      if(!r || r.width<2 || r.height<2)return false;
      try{const c=getComputedStyle(el);if(c.display==='none'||c.visibility==='hidden'||c.opacity==='0')return false;}catch{}
      if(vr&&vr.width>0&&vr.height>0){
        const x=r.left+r.width/2,y=r.top+r.height/2;
        if(x<vr.left-55||x>vr.right+55||y<vr.top-55||y>vr.bottom+55)return false;
      }
      return true;
    };
    const textOf=el=>plain(el.innerText||el.textContent||'');
    const isControl=el=>el.matches?.('button,[role="button"],[role="menuitem"],[role="option"],[tabindex]')||false;
    const candidates=()=>{
      const all=roots.flatMap(r=>Array.from(r.querySelectorAll('button,[role="button"],[role="menuitem"],[role="option"],li,[tabindex],div,span')));
      return all.filter(viable).map(el=>({el,text:textOf(el)})).filter(x=>x.text&&x.text.length<=65);
    };
    const pick=(filter)=>{
      const found=candidates().filter(x=>filter(x.text,x.el));
      // O elemento concreto tem prioridade sobre um contêiner que repete o texto.
      found.sort((a,b)=>(isControl(b.el)?1:0)-(isControl(a.el)?1:0)||a.text.length-b.text.length);
      return found[0]?.el||null;
    };
    const click=el=>{if(!el||!viable(el))return false;try{el.click();return true;}catch{return false;}};
    const heights=()=>{
      const found=candidates().map(({el,text})=>{
        const m=text.match(/^(144|180|240|360|480|540|720|1080|1440|2160)\\s*p?(?:\\s*(?:hd|sd|selecionad[oa]|selected))?$/);
        if(!m)return null;
        const height=Number(m[1]);
        const role=el.getAttribute?.('role');
        const selectionNode=el.closest?.('[role="menuitemradio"],[role="radio"],[role="option"],button,[aria-checked],[data-state],li')||el;
        const state=selectionNode.getAttribute?.('data-state')||'';
        const cls=String(selectionNode.className||'');
        const selected=selectionNode.getAttribute?.('aria-selected')==='true'||selectionNode.getAttribute?.('aria-checked')==='true'||
          /^(checked|selected|active)$/.test(state)||/(?:^|[\\s_-])(selected|active|checked)(?:$|[\\s_-])/i.test(cls)||
          Boolean(selectionNode.querySelector?.('svg[data-lucide="check"],svg.lucide-check,[data-icon="check"],[aria-label="Selecionado"]'));
        return {el,height,selected,role,text};
      }).filter(Boolean);
      // Resolve duplicados quando o texto surge no botão e no span descendente.
      const byHeight=new Map();for(const item of found)if(!byHeight.has(item.height)||isControl(item.el))byHeight.set(item.height,item);
      return [...byHeight.values()].sort((a,b)=>a.height-b.height);
    };
    const autoOption=()=>pick((t)=>/^(auto|automatico|automatic|automatica)$/.test(t));
    const qualityRow=()=>pick((t)=>/^(qualidade|quality)(?:\\s+(?:auto|automatico|automatica|automatic|\\d{3,4}\\s*p))?$/.test(t));
    // IMPORTANT: preferir não alterar a qualidade a clicar no controlo errado.
    // Em alguns players o botão de LEGENDAS possui classes CSS que incluem
    // "settings". Nunca usar essa substring genérica para identificar a roda.
    const closeCaptionWords=/\\b(legendas?|legends?|subtitles?|captions?|closed captions?|idioma|language|estilo|style|cc)\\b/;
    const exactSettings=/^(?:abrir\\s+|alterar\\s+|video\\s+|player\\s+)?(?:configurac(?:ao|oes)(?:\\s+do\\s+video)?|ajustes|settings|video settings|player settings|preferencias)$/;
    const settingsIcon=/\\b(?:settings|gear|cog|configuracoes|configuracao)(?:-icon)?\\b/;
    const speedRow=()=>pick(t=>/^(velocidade|speed)(?:\\s+(?:normal|\\d+(?:[.,]\\d+)?\\s*x))?$/.test(t));
    if(mode==='dismiss'){
      // Só fechar menus de qualidade Hotmart. Nunca clicar num controlo
      // aleatório que possa interromper o vídeo ou as legendas.
      for(const candidate of roots){
        const overlay=candidate.querySelector?.('[data-testid="floating-overlay"]');
        const qualityMenu=overlay?.querySelector?.('[role="menu"]');
        const entries=[...(qualityMenu?.querySelectorAll?.('button[role="menuitem"][aria-label]')||[])];
        if(!entries.some(e=>/^(auto|\d{3,4}p)$/i.test(e.getAttribute('aria-label')||'')))continue;
        const close=[...(overlay.querySelectorAll('button,[role="button"]'))].find(el=>
          /^(fechar|close|dismiss|close menu|fechar menu)$/i.test(plain(el.getAttribute('aria-label')||el.getAttribute('title'))));
        if(close){try{close.click();return {open:true,closed:true};}catch{}}
        return {open:true,closed:false};
      }
      return {open:false,closed:true};
    }
    function captionsPanelVisible(){
      // Identifica o submenu real, não apenas o botão de legendas na barra.
      return Boolean(pick(t=>t==='legendas'||t==='subtitles'||t==='captions')) &&
        Boolean(pick(t=>/^(idioma|language)(?:\\s+.*)?$/.test(t))) &&
        Boolean(pick(t=>/^(estilo|style)(?:\\s+.*)?$/.test(t)));
    }
    function settingsMenuVisible(){return Boolean(qualityRow()&&speedRow());}
    function findSettings(){
      const nodes=roots.flatMap(r=>Array.from(r.querySelectorAll('button,[role="button"],[aria-label],[title],[data-testid]')));
      const eligible=nodes.filter(el=>viable(el)&&isControl(el));
      const ranked=[];
      for(const el of eligible){
        const aria=plain(el.getAttribute?.('aria-label'));
        const title=plain(el.getAttribute?.('title'));
        const testId=plain(el.getAttribute?.('data-testid'));
        const ownText=textOf(el);
        const iconAttrs=Array.from(el.querySelectorAll?.('svg,[data-icon],[data-lucide],use')||[]).flatMap(svg=>[
          svg.getAttribute?.('data-icon'),svg.getAttribute?.('data-lucide'),svg.getAttribute?.('class'),svg.getAttribute?.('href'),svg.getAttribute?.('xlink:href')
        ]).map(plain).filter(Boolean);
        const combined=[aria,title,testId,ownText,...iconAttrs].join(' ');
        if(closeCaptionWords.test(combined))continue;
        // Somente acessibilidade explícita, identificador inequivocamente
        // de engrenagem, ou ícone SVG de configurações. Sem adivinhar por CSS
        // de um ancestral ou pela posição: isso abriu "Legendas" na v0.7.7.
        let score=0;
        if(exactSettings.test(aria)||exactSettings.test(title))score=100;
        else if(/^(?:player-)?(?:settings|gear|cog)(?:-button|-control|-trigger)?$/.test(testId))score=90;
        else if(iconAttrs.some(x=>settingsIcon.test(x)))score=80;
        if(score)ranked.push({el,score});
      }
      ranked.sort((a,b)=>b.score-a.score);
      // Dois controlos igualmente prováveis => não clicar em nenhum.
      if(!ranked.length||(ranked.length>1&&ranked[0].score===ranked[1].score))return null;
      return ranked[0].el;
    }
    async function openQuality(){
      if(heights().length)return true;
      if(captionsPanelVisible())return false;
      let row=qualityRow();
      if(!settingsMenuVisible()){
        const settings=findSettings();
        if(!settings||!click(settings))return false;
        await wait(200);
        if(!settingsMenuVisible())return false; // Nunca tentar Legendas > Idioma.
        row=qualityRow();
      }
      if(!row)row=qualityRow();
      if(!row||!click(row))return false;
      await wait(220);
      return heights().length>0;
    }
    // As opções do player Hotmart podem rejeitar element.click() porque cria
    // eventos não fiáveis (isTrusted=false). O modo target apenas localiza
    // a opção; o background enviará Input.dispatchMouseEvent pelo CDP.
    // Nunca clicar noutra opção por aproximação ou posição fixa.
    if(mode==='target'||mode==='retry-target'){
      if(!(await openQuality()))return {found:true,ready:false,applied:false,
        status:captionsPanelVisible()?'O menu Legendas está aberto; fecha-o antes de alterar a qualidade':
          'Não foi possível localizar com segurança o menu Qualidade'};
      const option=heights()[0];
      if(!option)return {found:true,ready:false,applied:false,status:'Não existem resoluções explícitas no menu'};
      // Centro do elemento efetivamente interativo: o texto pode estar num span.
      let hit=option.el;
      for(let node=option.el;node && node!==video;node=node.parentElement){
        if(!viable(node))break;
        if(node.matches?.('button,[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],li')){hit=node;break;}
        const css=node.getAttribute?.('data-testid')||'';
        if(/quality|resolution|option/i.test(css)){hit=node;break;}
      }
      try{hit.scrollIntoView?.({block:'nearest'});}catch{}
      const rect=rectOf(hit);
      if(!rect || rect.width<3 || rect.height<3 || !viable(hit))return {found:true,ready:false,applied:false,
        status:'A opção de resolução não tem uma área de clique visível'};
      const previousRaw=qualityRow()?.innerText?.match(/(?:qualidade|quality)\s*(auto|\d{3,4}\s*p)/i)?.[1]||'Auto';
      const previous=plain(previousRaw)==='auto'?'Auto':Number.parseInt(previousRaw)||'Auto';
      // A segunda tentativa privilegia o centro do texto da resolução, não
      // o centro de um item grande que pode conter overlays de ícones.
      // Só é permitida depois de uma tentativa anterior não confirmada.
      const retry=mode==='retry-target';
      if(retry){
        const saved=backups.get(video);
        if(!saved||saved.height!==option.height||saved.confirmed)return {found:true,ready:false,
          status:'Não existe uma seleção 240p pendente de confirmação'};
      }
      const labelRect=retry?rectOf(option.el):null;
      let x=retry&&labelRect?.width>3?labelRect.left+Math.min(labelRect.width/3,30):rect.left+rect.width/2;
      let y=retry&&labelRect?.height>3?labelRect.top+labelRect.height/2:rect.top+rect.height/2;
      const hitDoc=hit.ownerDocument||video.ownerDocument||document;
      const hitWindow=hitDoc.defaultView||(typeof window!=='undefined'?window:null);
      const visibleAt=(cx,cy)=>{
        try{
          const under=hitDoc.elementFromPoint(cx,cy);
          return !under || under===hit || hit.contains?.(under) || under.contains?.(hit);
        }catch{return true;}
      };
      if(!visibleAt(x,y))return {found:true,ready:false,applied:false,
        status:'O item '+option.height+'p está tapado por outro elemento. Abre Qualidade e tenta novamente.'};
      // Num iframe no mesmo target do tab, Input.dispatchMouseEvent recebe
      // coordenadas do viewport PRINCIPAL, não do viewport do iframe.
      // Num OOPIF com sessionId próprio, o background pede coordenadas locais.
      if(relativeToTab && hitWindow){
        try{
          let frame=hitWindow,depth=0;
          while(frame && frame!==frame.parent && depth++<8){
            const host=frame.frameElement;
            if(!host)break; // cross-origin: não inventar um offset.
            const parentRect=host.getBoundingClientRect();
            x+=parentRect.left;y+=parentRect.top;
            frame=frame.parent;
          }
        }catch{}
      }
      if(!retry)backups.set(video,{height:option.height,previous,confirmed:false,triedAt:Date.now(),trustedPending:true});
      // Antes de clicar, a função já verificou que o ponto está dentro da
      // opção pretendida no DOM do frame; não clica em coordenadas inventadas.
      if(!visibleAt(retry&&labelRect?.width>3?labelRect.left+Math.min(labelRect.width/3,30):rect.left+rect.width/2,
        retry&&labelRect?.height>3?labelRect.top+labelRect.height/2:rect.top+rect.height/2))return {
        found:true,ready:false,status:'O ponto alternativo está obstruído; sem novo clique'};
      return {found:true,ready:true,applied:false,provider:'Hotmart Player (menu)',height:option.height,
        previous,x:Math.round(x),y:Math.round(y),retry,coordinateFrame:relativeToTab?'tab':'target',
        status:'Opção '+option.height+'p identificada; a enviar clique de utilizador pelo Brave'};
    }
    if(mode==='focus-target'){
      const saved=backups.get(video);
      if(!saved || Date.now()-saved.triedAt>12000)return {found:true,ready:false,status:'Seleção de qualidade já expirou'};
      const option=heights().find(o=>o.height===saved.height);
      let node=option?.el;
      while(node && node!==video){
        if(node.matches?.('button,[role="option"],[role="menuitem"],[role="menuitemradio"],[role="radio"],a,input,[tabindex]'))break;
        node=node.parentElement;
      }
      if(!node || typeof node.focus!=='function')return {found:true,ready:false,status:'A opção de qualidade não é acessível por teclado'};
      try{node.focus({preventScroll:true});}catch{return {found:true,ready:false,status:'Não foi possível focar a opção de qualidade'};}
      const hasFocus=node.ownerDocument?.activeElement===node||node.getRootNode?.().activeElement===node;
      return {found:true,ready:hasFocus,
        status:hasFocus?'Opção de qualidade focada':'O player recusou o foco'};
    }
    if(mode==='verify'){
      const saved=backups.get(video);
      if(!saved)return {found:true,applied:false,status:'Não existe uma seleção de qualidade pendente para confirmar'};
      // O player fecha o menu ao selecionar. Reabrir para confirmar
      // o visto e não reportar falsos negativos após um clique aceite.
      const opened=heights().length>0?true:await openQuality();
      const row=plain(qualityRow()?.innerText||'');
      const rowConfirmed=new RegExp('\\\\b'+saved.height+'\\\\s*p\\\\b').test(row);
      const selected=heights().find(x=>x.height===saved.height)?.selected===true;
      const confirmed=rowConfirmed||selected;
      saved.confirmed=confirmed;
      return {found:true,applied:confirmed,requested:true,provider:'Hotmart Player (menu)',height:saved.height,
        observedHeight:Number(video.videoHeight)||null,menuOpenedForVerification:opened,
        status:confirmed?'Qualidade '+saved.height+'p confirmada no player':
          opened?'O player não confirmou '+saved.height+'p; verifica o visto no menu Qualidade':
            'Clique para '+saved.height+'p enviado, mas não foi possível reabrir o menu para confirmar'};
    }
    if(mode==='min' && failures.has(video) && !heights().length && !settingsMenuVisible())return {found:true,applied:false,unsupported:true,doNotRetry:true,
      status:'Seleção automática suspensa: controlo de qualidade não identificado com segurança. A captura WEBVTT continua.'};
    if(mode==='restore'){
      const saved=backups.get(video);
      if(!saved)return {found:true,applied:false,restored:true,status:'Não existe seleção do menu para repor'};
      if(!(await openQuality()))return {found:true,applied:false,restored:false,status:'Não foi possível reabrir o menu para repor a qualidade'};
      const option=saved.previous==='Auto'?autoOption():heights().find(x=>x.height===saved.previous)?.el;
      if(!click(option))return {found:true,applied:false,restored:false,status:'Qualidade original indisponível para reposição'};
      backups.delete(video);
      return {found:true,applied:false,restored:true,provider:'Hotmart Player (menu)',status:'Qualidade original reposta no menu do player'};
    }
    const saved=backups.get(video);
    if(saved){
      const current=plain(qualityRow()?.innerText||'');
      const confirmed=saved.confirmed||new RegExp('\\\\b'+saved.height+'\\\\s*p\\\\b').test(current)||
        (Number(video.videoHeight)>0 && Number(video.videoHeight)<=saved.height);
      if(confirmed)saved.confirmed=true;
      if(!confirmed && Date.now()-(saved.triedAt||0)>=4000){backups.delete(video);}
      else return {found:true,applied:confirmed,provider:'Hotmart Player (menu)',height:saved.height,
        observedHeight:Number(video.videoHeight)||null,status:confirmed?'Qualidade '+saved.height+'p confirmada no player':
        'Seleção de '+saved.height+'p enviada; a aguardar confirmação da resolução pelo player'};
    }
    const rowBefore=qualityRow();
    const previousFromRow=rowBefore?.innerText?.match(/(?:qualidade|quality)\\s*(auto|\\d{3,4}\\s*p)/i)?.[1]||null;
    if(!(await openQuality())){
      failures.set(video,true);
      return {found:true,applied:false,unsupported:true,doNotRetry:true,
        status:captionsPanelVisible()?'O submenu Legendas está aberto. Fecha-o; a extensão não voltará a clicar automaticamente nele.':
          'Controlo de qualidade não identificado com segurança. Seleção automática suspensa para esta aula; define a qualidade manualmente.'};
    }
    const levels=heights();
    const option=levels[0];
    const previousSelected=levels.find(x=>x.selected);
    const previous=previousSelected?.height||(previousFromRow?.toLowerCase()==='auto'?'Auto':Number.parseInt(previousFromRow)||'Auto');
    if(!option||!click(option.el))return {found:true,applied:false,unsupported:true,doNotRetry:true,status:'Não foi possível selecionar uma resolução do menu'};
    await wait(280);
    const observedHeight=Number(video.videoHeight)||null;
    const displayed=plain(qualityRow()?.innerText||'');
    const confirmed=new RegExp('\\\\b'+option.height+'\\\\s*p\\\\b').test(displayed)||
      (observedHeight>0 && observedHeight<=option.height);
    backups.set(video,{height:option.height,previous,confirmed,triedAt:Date.now()});
    return {found:true,applied:confirmed,requested:true,provider:'Hotmart Player (menu)',height:option.height,observedHeight,
      status:option.height>240?'Menor resolução disponível: '+option.height+'p (não existe opção de 240p ou inferior)':
      confirmed?'Qualidade '+option.height+'p confirmada no menu do player':
      'Tentativa de selecionar '+option.height+'p enviada; o player ainda não confirmou a mudança'};
  })()`;
}
