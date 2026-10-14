// FHAD VTT Capture — sinais precoces de reprodução, em TODOS os frames Hotmart.
// Não recolhe conteúdo, não altera o player e não interfere com os segmentos VTT.
// O background continua a ser a única autoridade para iniciar a alteração de qualidade.
(() => {
  if (globalThis.__fhadVttPlayerStartEvents_v085) return;
  globalThis.__fhadVttPlayerStartEvents_v085 = true;
  const watched = new WeakSet();
  const roots = new WeakSet();
  const recent = new WeakMap();
  let inactive = false;
  const observers = [];

  function shutdown() {
    if (inactive) return;
    inactive = true;
    for (const observer of observers) observer.disconnect();
  }
  function notify(video, reason) {
    if (inactive || video.paused || video.ended || video.readyState < 2) return;
    const now = Date.now();
    const prev = recent.get(video);
    // Os eventos loadeddata/canplay/playing podem ocorrer em sequência.
    // Permitir novo sinal se mudou o readyState, mas evitar inundar o worker.
    const minGap = reason === 'timeupdate' && video.currentTime > 15 ? 4000 : 750;
    if (prev && now - prev.at < minGap && prev.readyState === video.readyState) return;
    recent.set(video, { at: now, readyState: video.readyState });
    try {
      if (!chrome.runtime?.id) { shutdown(); return; }
      const result = chrome.runtime.sendMessage({type: 'PLAYER_ACTIVITY', reason, frameUrl: location.href});
      result?.catch?.(e => { if (/context invalidated/i.test(String(e?.message || e))) shutdown(); });
    } catch (e) {
      if (/context invalidated/i.test(String(e?.message || e))) shutdown();
    }
  }
  function attach(video) {
    if (watched.has(video)) return;
    watched.add(video);
    for (const name of ['play', 'playing', 'loadeddata', 'canplay', 'loadedmetadata']) {
      video.addEventListener(name, () => notify(video, name), {passive:true});
    }
    // Recuperação rápida se o evento playing for perdido durante um SPA
    // ou se a página já estiver a reproduzir quando o script é injetado.
    video.addEventListener('timeupdate', () => {
      // A captura pode ser iniciada a meio de uma aula já em curso; uma
      // verificação a cada ~4 s substitui esperas de 30 s dos alarmes.
      notify(video, 'timeupdate');
    }, {passive:true});
    notify(video, 'detetado em reprodução');
  }
  function scan(root) {
    if (!root || inactive) return;
    for (const video of root.querySelectorAll?.('video') || []) attach(video);
    for (const el of root.querySelectorAll?.('*') || []) {
      if (el.shadowRoot) observe(el.shadowRoot);
    }
  }
  function observe(root) {
    if (!root || roots.has(root)) return;
    roots.add(root);
    scan(root);
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches?.('video')) attach(node);
          if (node.shadowRoot) observe(node.shadowRoot);
          scan(node);
        }
      }
    });
    observer.observe(root, {childList: true, subtree: true});
    observers.push(observer);
  }
  observe(document);
})();
