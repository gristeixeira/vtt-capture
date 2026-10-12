// A página Hotmart apresenta o título da aula num <h1 class="... text-2xl">.
// A interface utiliza Web Components com Shadow DOM aberto: querySelector(document)
// sozinho não chega. Este script observa também todas as shadow roots abertas.
(() => {
  const observed = new WeakSet();
  const roots = [];
  const mediaListeners = new WeakSet();
  let lastPayload = '';
  let pendingPayload = '';
  let pendingSince = 0;
  let scanTimer = null;
  let periodicTimer = null;
  let lastScanAt=0;
  let inactive = false;
  const observers = [];
  function shutdownOldContext(){
    if(inactive)return;
    inactive=true;
    clearTimeout(scanTimer);
    if(periodicTimer!==null)clearInterval(periodicTimer);
    for(const observer of observers)observer.disconnect();
  }
  // Ao recarregar a extensão no Brave, os scripts já injetados ficam sem
  // acesso ao runtime até atualizar a página. Não gerar erros repetidos.
  function safeSendMessage(payload){
    if(inactive)return;
    try{
      if(!chrome.runtime?.id){shutdownOldContext();return;}
      const result=chrome.runtime.sendMessage(payload);
      result?.catch?.(e=>{
        if(/Extension context invalidated|context invalidated/i.test(String(e?.message||e)))shutdownOldContext();
      });
    }catch(e){
      if(/Extension context invalidated|context invalidated/i.test(String(e?.message||e)))shutdownOldContext();
      else console.warn('FHAD VTT: comunicação indisponível',e);
    }
  }

  const normalize = text => String(text || '').replace(/\s+/g, ' ').trim();
  const valid = text => text.length >= 4 && text.length <= 180 &&
    !/^(hotmart|club hotmart|aulas|conteúdos|módulos|próxima aula|suporte|continuar|entrar|materiais|meus cursos|biblioteca)$/i.test(text);
  const visible = el => Boolean(el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');

  function scheduleScan() {
    if(inactive)return;
    // O player atualiza o DOM continuamente (legendas, barras, animações).
    // Debounce com clearTimeout poderia adiar a deteção indefinidamente.
    // Usar throttle: garantir uma inspeção mesmo com mutações contínuas.
    if(scanTimer!==null)return;
    scanTimer=setTimeout(()=>{
      scanTimer=null;
      lastScanAt=Date.now();
      sendMetadata();
    },Math.max(50,350-(Date.now()-lastScanAt)));
  }
  function observeRoot(root) {
    if (observed.has(root)) return;
    observed.add(root);
    roots.push(root);
    const observer=new MutationObserver(scheduleScan);
    observers.push(observer);
    observer.observe(root, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['src', 'title', 'aria-current', 'class']
    });
  }
  function discoverShadowRoots() {
    // Shadow roots aninhadas (ex.: ch-structure > ch-container > app-club-consumer).
    for (let i = 0; i < roots.length; i++) {
      for (const host of roots[i].querySelectorAll('*')) {
        if (host.shadowRoot) observeRoot(host.shadowRoot);
      }
    }
  }
  function readFromRoots(selectors) {
    for (const selector of selectors) {
      for (const root of roots) {
        for (const el of root.querySelectorAll(selector)) {
          if (!visible(el)) continue;
          const text = normalize(el.getAttribute('aria-label') || el.textContent);
          if (valid(text)) return text;
        }
      }
    }
    return '';
  }
  function metadata() {
    // Prioridade 1: h1 exato do DevTools enviado pelo utilizador.
    const hotmartHeading = readFromRoots(['h1.text-2xl', 'h1[class*="text-2xl"]']);
    const genericHeading = hotmartHeading || readFromRoots([
      '[data-testid*="lesson-title" i]', '[data-test*="lesson-title" i]',
      '[data-testid*="content-title" i]', 'main h1', 'h1'
    ]);
    const parts = normalize(document.title).split(/\s+[|–—-]\s+/).filter(valid);
    const title = genericHeading || parts[0] || 'Aula sem título';
    const course = readFromRoots(['[data-testid="course-title"]', '[data-test="course-title"]']) ||
      parts.find(x => x !== title && !/hotmart|club/i.test(x)) || 'Hotmart';
    const video = roots.flatMap(root => [...root.querySelectorAll('video')]).find(visible);
    const source = video?.currentSrc || video?.src || '';
    const mediaKey = source && !source.startsWith('data:') ? source.replace(/[?#].*$/, '').slice(-180) : '';
    return {url: location.href, title, course,
      confidence: hotmartHeading ? 'alta' : genericHeading ? 'média' : 'baixa', mediaKey};
  }
  function sendMetadata() {
    if(inactive)return;
    if(!chrome.runtime?.id){shutdownOldContext();return;}
    discoverShadowRoots();
    for (const root of roots) {
      for (const video of root.querySelectorAll('video')) {
        if (mediaListeners.has(video)) continue;
        mediaListeners.add(video);
        for (const ev of ['loadedmetadata', 'emptied', 'loadstart', 'ended']) {
          video.addEventListener(ev, scheduleScan);
        }
        video.addEventListener('ended', () => safeSendMessage({type:'PLAYER_ENDED',pageUrl:location.href}));
        // Se a aula usar um <video> acessível na página, aplicar a velocidade
        // escolhida logo após o carregamento/arranque do próximo vídeo.
        for(const eventName of ['loadedmetadata','playing'])
          video.addEventListener(eventName,()=>safeSendMessage({type:'PLAYER_ACTIVITY'}));
      }
    }
    const next = metadata();
    const encoded = JSON.stringify(next);
    if (encoded === lastPayload) return;
    // Evitar falsos positivos durante transições: o React pode apresentar
    // temporariamente o h1 da aula anterior com o URL da aula seguinte.
    if(pendingPayload !== encoded){ pendingPayload=encoded;pendingSince=Date.now();return; }
    if(Date.now()-pendingSince<750)return;
    lastPayload = encoded;
    safeSendMessage({type: 'METADATA', meta: next});
  }
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    // Consulta direta, independente do debounce de METADATA: o background pode
    // recuperar o título mesmo se a mensagem de alteração de aula se perdeu.
    if (msg?.type === 'READ_METADATA') {
      if(inactive){reply({ok:false});return;}
      discoverShadowRoots();
      reply({ok:true,meta:metadata()});
      return;
    }
    if (msg?.type === 'SCAN') { lastPayload = ''; pendingPayload='';pendingSince=0; sendMetadata();setTimeout(sendMetadata,850);return; }
    if (msg?.type === 'ADVANCE_NEXT') {
      const found=globalThis.fhadFindNextLesson?.();
      if(!found?.ok){reply({ok:false,reason:found?.reason||'Navegação indisponível'});return;}
      found.element.click();reply({ok:true,mode:found.mode});return;
    }
  });
  observeRoot(document);
  discoverShadowRoots();
  window.addEventListener('popstate', scheduleScan);
  window.addEventListener('hashchange', scheduleScan);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleScan(); });
  // React/SPA pode mudar a aula sem originar um mutation event no document.
  periodicTimer=setInterval(sendMetadata, 1200);
  sendMetadata();
  setTimeout(sendMetadata,850);
})();
