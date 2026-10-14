const $=id=>document.getElementById(id);
let cachedState=null,activeTabId=null,busy=false,loading=false,loadAgain=false;
$('extensionVersion').textContent='v'+chrome.runtime.getManifest().version;
const selectedLessons=new Set();
const eligibleMergeSources=state=>state?.lessons?.filter(l=>l.supersededBy && l.id!==state.currentId && (()=>{
  const result=state.lessons.find(x=>x.id===l.supersededBy);
  return result && result.id!==state.currentId && result.exportStatus==='concluído' && result.endedAt &&
    result.exportedSegments===result.segments && (result.exportedCues===undefined || result.exportedCues===result.cueCount) &&
    (result.exportedTitle===undefined || result.exportedTitle===result.title) &&
    (result.exportedCourse===undefined || result.exportedCourse===result.course);
})()) || [];
const eligibleEmpty=state=>state?.lessons?.filter(l=>l.id!==state.currentId && l.segments===0 && l.cueCount===0) || [];
const eligibleToClear=state=>state?.lessons?.filter(l=>l.id!==state.currentId && l.endedAt && l.exportStatus==='concluído' && l.cueCount>0 && l.exportedSegments===l.segments && (l.exportedCues===undefined || l.exportedCues===l.cueCount) && (l.exportedTitle===undefined || l.exportedTitle===l.title) && (l.exportedCourse===undefined || l.exportedCourse===l.course)) || [];
const exportable=l=>Boolean(l?.cueCount>0 && !l.supersededBy);
const mergeable=(l,state)=>exportable(l) && l.id!==state?.currentId && Boolean(l.endedAt);
function updateSelectionControls(state=cachedState){
  const chosen=(state?.lessons||[]).filter(l=>selectedLessons.has(l.id) && exportable(l));
  const available=(state?.lessons||[]).filter(exportable);
  const selectAll=$('selectAll');
  selectAll.disabled=!available.length || busy;
  selectAll.checked=Boolean(available.length && chosen.length===available.length);
  selectAll.indeterminate=Boolean(chosen.length && chosen.length<available.length);
  $('exportLessons').disabled=!available.length || busy;
  $('exportLessons').textContent=chosen.length
    ?`↓ Descarregar aulas selecionadas (${chosen.length})`
    :`↓ Descarregar todas as aulas (${available.length})`;
  $('merge').disabled=chosen.length<2 || chosen.some(l=>!mergeable(l,state)) || busy;
  $('merge').textContent=`⤨ Juntar capturas selecionadas (${chosen.length})`;
}
const ask=async msg=>{const response=await chrome.runtime.sendMessage(msg);if(!response?.ok)throw Error(response?.error||'Erro inesperado');return response;};
function info(text,good=false){const el=$('message');el.hidden=!text;el.className=good?'notice ok':'notice';el.textContent=text;}
function escape(s){return String(s||'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));}
async function load(){
  // Sem requisições concorrentes: uma resposta mais antiga não pode sobrescrever
  // o estado mais recente depois de fechar/reabrir o popup.
  if(loading){loadAgain=true;return;}
  loading=true;
  try{
    // Procurar a aba ANTES de STATE: o worker precisa do ID para validar
    // a ligação CDP ativa depois de fechar/reabrir o popup.
    let tabs=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tabs.some(t=>Number.isSafeInteger(t.id) && /hotmart\.com/i.test(t.url||'')))
      tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    activeTabId=tabs.find(t=>Number.isSafeInteger(t.id) && /hotmart\.com/i.test(t.url||''))?.id ?? null;
    const {state}=await ask({type:'STATE',tabId:activeTabId});cachedState=state;
    const capturingHere=state.tracking&&state.tabId===activeTabId;
    const health=state.sessionHealth||{};
    $('status').textContent=state.tracking?(health.connected?'A GRAVAR':'A VERIFICAR'):'PARADO';
    $('status').className='status '+(state.tracking?(health.connected?'on':'checking'):'off');
    $('start').hidden=state.tracking;$('stop').hidden=!state.tracking;
    const received=state.lastSegmentAt;
    $('captureHealth').textContent=state.tracking?
      (health.connected?'● Ligação de captura confirmada':'⚠ Ligação ao Brave não confirmada nesta verificação')+
      (received?` · Último bloco VTT às ${new Date(received).toLocaleTimeString('pt-PT')}`:' · Ainda sem blocos VTT nesta sessão'):
      'Sem captura ativa confirmada. Um número antigo no ícone não prova que ainda esteja a gravar.';
    // O background pode resolver o separador ativo se o popup não obtiver o ID.
    $('help').textContent=state.sessionNotice && state.tracking? state.sessionNotice+' Captura ativa neste separador.':state.tracking?(state.routePending ? 'Nova aula detetada pela URL. A aguardar o título correto; os segmentos já são guardados numa captura separada.' : capturingHere?'Captura ativa neste separador. Podes fechar esta janela; continua a gravar.':'Captura ativa noutro separador. Volta a esse separador para ver a aula atual.'):'Abre uma aula Hotmart e clica em iniciar. Não abras o DevTools no mesmo separador durante a captura.';
    const current=state.lessons.find(l=>l.id===state.currentId);
    if(document.activeElement!==$('currentTitle'))$('currentTitle').value=current?.title||'';
    const currentTitle=current?.title?.trim()||'Aguardando aula…';
    $('currentLessonSummary').textContent=currentTitle;
    $('currentLessonSummary').title=currentTitle;
    $('currentCueCount').textContent=`${current?.segments||0} blocos · ${current?.cueCount||0} falas`;
    $('rename').disabled=!current;$('split').disabled=!state.tracking || !capturingHere;
    $('lessonCount').textContent=String(state.lessons.length);
    const desiredRate=Number(state.playbackSpeed)||1;
    $('speedCurrent').textContent=`${desiredRate}×`;
    const speedState=state.speedStatus||{};
    $('speedStatus').textContent=state.tracking ? (speedState.status||'A procurar player…') : 'Inicia a captura para controlar a velocidade.';
    document.querySelectorAll('[data-speed]').forEach(button=>{
      const selected=Number(button.dataset.speed)===desiredRate;
      button.classList.toggle('speed-active',selected);
      button.setAttribute('aria-pressed',String(selected));
      button.disabled=!state.tracking || busy;
    });
    $('autoRecover').checked=state.autoRecover!==false;
    $('qualityMin').checked=state.qualityMinOnCapture!==false;
    $('qualityMin').disabled=busy;
    $('qualityCheck').disabled=!state.tracking||busy;
    $('qualityCurrent').textContent=state.qualityMinOnCapture===false?'Desativada':state.qualityStatus?.applied?(state.qualityStatus.height?state.qualityStatus.height+'p pedida':'Mínima pedida'):'Por confirmar';
    const quality=state.qualityStatus||{};
    $('qualityStatus').textContent=!state.tracking?'Captura parada: não está a controlar a qualidade do vídeo. Inicia a captura para tentar reduzir a resolução.':
      (quality.status||'A verificar compatibilidade do player…')+
      (quality.observedHeight?` · Resolução observada: ${quality.observedHeight}p (altura do vídeo)`:'')+
      (quality.contextType==='isolado'?' · API do player não acessível neste contexto':'');
    const playback=state.playback||{};
    $('playerStatus').textContent=playback.status||'A aguardar vídeo';
    const hhmm=(seconds)=>Number.isFinite(seconds)?`${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`:'--:--';
    $('playerTime').textContent=playback.currentTime!==undefined && playback.status!=='tempo do player indisponível — captura VTT continua ativa'?`${hhmm(playback.currentTime)} / ${hhmm(playback.duration)} · tentativas: retoma ${playback.resumeAttempts||0}, avanço ${playback.advanceAttempts||0}`:playback.contextsInspected!==undefined?`Inspecionados ${playback.contextsInspected} contexto(s) em ${playback.targetsInspected} frame/target(s). O player pode não expor tempo HTML5; as legendas continuam a ser guardadas.`:'A verificação demora até 30 s. Alguns players não permitem consultar o tempo de reprodução.';
    $('checkPlayer').disabled=!state.tracking; $('nextLesson').disabled=!state.tracking || !capturingHere;
    const clearableIds=new Set([...eligibleToClear(state),...eligibleEmpty(state),...eligibleMergeSources(state)].map(l=>l.id));
    $('clearEligible').disabled=!clearableIds.size;
    $('clearEligible').textContent=`♻ Limpar tudo o que for seguro (${clearableIds.size})`;
    const allowedIds=new Set(state.lessons.filter(exportable).map(l=>l.id));
    for(const id of selectedLessons)if(!allowedIds.has(id))selectedLessons.delete(id);
    updateSelectionControls(state);
    $('lessons').innerHTML=state.lessons.length? [...state.lessons].reverse().map(l=>{
      const active=l.id===state.currentId;
      const superseded=Boolean(l.supersededBy);
      const merged=Boolean(l.mergeSources?.length);
      const baseStatus=active?'A capturar · guardada no Brave':superseded?'Fonte de merge · cópia de segurança':l.exportStatus==='erro'?'Falha no último download':l.exportStatus==='a descarregar'?'Download solicitado':l.exportStatus==='concluído' && l.exportedSegments>=l.segments?'ZIP descarregado · cópia local mantida':l.exportStatus==='concluído'?'Atualizada · pode descarregar de novo':'Guardada no Brave · ainda não descarregada';
      const completion=l.completedOnPlatform?' · ✓ Vista na Hotmart':l.completionStatus && l.completionStatus!=='A aguardar fim do vídeo'?` · ${l.completionStatus}`:'';
      const status=baseStatus+completion;
      const review=l.confidence!=='alta'||l.warnings?.length;
      const selectable=exportable(l);
      const label=merged?`<span class="merge-note">✓ Consolidação: ${l.mergeSources.length} capturas · ${l.mergeRemovedCues||0} duplicadas removidas</span><br>`:superseded?'<span class="merge-note">Incluída numa consolidação</span><br>':'';
      return `<div class="lesson${merged?' merged':''}${superseded?' superseded':''}">
        <input class="merge-select" type="checkbox" aria-label="Selecionar aula para descarregar ou juntar" data-merge="${escape(l.id)}" ${selectedLessons.has(l.id)?'checked':''} ${selectable?'':'disabled'}>
        <div><div class="lesson-title">${escape(l.title)}${active?' ●':''}</div>
        <div class="lesson-meta">${l.segments} blocos VTT · ${l.cueCount} falas · <span class="${review?'review':'good'}">${review?'Verificar aula':'Identificação confirmada'}</span><br>${label}${escape(status)}</div></div>
        <div class="lesson-buttons"><button class="secondary" data-edit="${escape(l.id)}" title="Corrigir título" ${superseded?'disabled':''}>✎</button>
        ${merged?`<button class="secondary" data-undo="${escape(l.id)}" title="Desfazer merge" ${l.exportStatus==='a descarregar'||l.supersededBy?'disabled':''}>↶</button>`:''}
        <button class="secondary" data-id="${escape(l.id)}" ${!l.cueCount||superseded?'disabled':''}>↓ ZIP</button></div></div>`;
    }).join(''):'<div class="empty">Ainda sem aulas.</div>';
    $('events').innerHTML=state.log?.length?state.log.slice(0,8).map(l=>`<li>${escape(l.when.slice(11,19))} — ${escape(l.text)}</li>`).join(''):'<li>Sem eventos.</li>';
    if(state.lastError)info(state.lastError);
  }catch(e){info(e.message);}
  finally{loading=false;if(loadAgain){loadAgain=false;void load();}}
}
async function work(message,success){if(busy)return;busy=true;
  try{await ask(message);info(success||'Operação concluída.',true);await load();}
  catch(e){info(e.message);}
  finally{busy=false;}
}
$('speedButtons').addEventListener('click',async ev=>{
  const button=ev.target.closest('button[data-speed]');
  if(!button || busy)return;
  const speed=Number(button.dataset.speed);
  if(!cachedState?.tracking)return;
  busy=true;
  try{
    const result=await ask({type:'SPEED_SET',speed});
    await load();
    info(result.status,Boolean(result.applied && Math.abs(result.applied-speed)<0.06));
  }catch(e){info(e.message);}
  finally{busy=false;await load();}
});
$('qualityMin').addEventListener('change',ev=>work({type:'QUALITY_SET',enabled:ev.target.checked},ev.target.checked?'Redução de qualidade ativada quando suportada.':'Redução de qualidade desativada.'));
$('qualityCheck').addEventListener('click',()=>work({type:'QUALITY_CHECK'},'Qualidade verificada. Consulta o resultado no painel.'));
$('autoRecover').addEventListener('change',ev=>work({type:'RECOVER_SETTINGS',enabled:ev.target.checked},ev.target.checked?'Recuperação automática ativada.':'Recuperação automática desativada.'));
$('checkPlayer').addEventListener('click',()=>work({type:'CHECK_PLAYER'},'Estado do vídeo atualizado.'));
$('nextLesson').addEventListener('click',()=>work({type:'NEXT_LESSON'},'Pedido de próxima aula enviado.'));
function formatStartTime(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
async function startCaptureWithMode(mode,previousId){
  if(busy)return;
  busy=true;
  try {
    await ask({type:'START',tabId:activeTabId,mode,resumeLessonId:previousId||null});
    await load();
    info(mode==='resume'?'Captura anterior retomada, mantendo as legendas existentes.':'Captura iniciada após regressar ao início do vídeo.',true);
  }catch(e){info(e.message);}finally{busy=false;}
}
$('start').addEventListener('click',async()=>{
  if(busy)return;
  busy=true;
  try {
    const prepared=await ask({type:'PREPARE_START',tabId:activeTabId});
    if(!prepared.video){info('Vídeo ainda não acessível. Espera o player carregar e volta a tentar.');return;}
    const matches=prepared.matches||[];
    if(!matches.length){busy=false;await startCaptureWithMode('fresh');return;}
    const selector=$('resumeFrom');
    selector.replaceChildren(...matches.map(item=>{
      const option=document.createElement('option');option.value=item.id;
      option.textContent=`${item.title} · ${item.segments} blocos · ${formatStartTime(item.lastCueMs/1000)}`;
      return option;
    }));
    const describe=()=>{
      const selected=matches.find(item=>item.id===selector.value);
      $('resumeDescription').textContent=selected?
        `Continuar desde aproximadamente ${formatStartTime(Math.max(0,selected.lastCueMs/1000-8))}, com 8 segundos de sobreposição para evitar perder legendas. Se criares uma nova captura, a anterior é preservada.`:'';
    };
    selector.onchange=describe;describe();
    $('resumeDialog').showModal();
  }catch(e){info(e.message);}finally{busy=false;}
});
$('resumeExisting').addEventListener('click',async()=>{
  const id=$('resumeFrom').value;$('resumeDialog').close();await startCaptureWithMode('resume',id);
});
$('restartCapture').addEventListener('click',async()=>{
  $('resumeDialog').close();await startCaptureWithMode('restart');
});
$('cancelStart').addEventListener('click',()=>$('resumeDialog').close());
$('stop').addEventListener('click',()=>work({type:'STOP'},'Captura parada. Os dados continuam guardados no Brave. Descarrega apenas quando quiseres.'));
$('refresh').addEventListener('click',load);
$('rename').addEventListener('click',()=>{
  const lessonId=cachedState?.currentId; if(!lessonId)return;
  work({type:'RENAME',lessonId,title:$('currentTitle').value},'Título confirmado.');
});
$('split').addEventListener('click',()=>{
  const title=$('currentTitle').value.trim();
  const suggested=title && title!=='Aula sem título' ? `${title} - seguinte` : 'Nova aula';
  const next=prompt('Título da nova aula (os segmentos seguintes serão atribuídos a ela):',suggested);
  if(next?.trim())work({type:'SPLIT',title:next.trim()},'Nova aula iniciada.');
});
$('lessons').addEventListener('change',ev=>{
  const checkbox=ev.target.closest('input[data-merge]');if(!checkbox)return;
  if(checkbox.checked)selectedLessons.add(checkbox.dataset.merge);
  else selectedLessons.delete(checkbox.dataset.merge);
  updateSelectionControls();
});
$('selectAll').addEventListener('change',ev=>{
  const available=(cachedState?.lessons||[]).filter(exportable);
  if(ev.target.checked){
    for(const lesson of available)selectedLessons.add(lesson.id);
  }else{
    selectedLessons.clear();
  }
  document.querySelectorAll('input[data-merge]').forEach(el=>{el.checked=selectedLessons.has(el.dataset.merge);});
  updateSelectionControls();
});
$('exportLessons').addEventListener('click',async()=>{
  if(busy || !cachedState)return;
  const available=cachedState.lessons.filter(exportable);
  if(!available.length)return;
  const ids=available.filter(l=>selectedLessons.has(l.id)).map(l=>l.id);
  const hasSelection=ids.length>0;
  if(hasSelection && ids.includes(cachedState.currentId) &&
     !confirm('Selecionaste a aula que ainda está a ser capturada. O ZIP conterá apenas as legendas recebidas até agora. Continuar?'))return;
  busy=true;updateSelectionControls();
  try{
    if(hasSelection){
      const result=await ask({type:'EXPORT_SELECTED',lessonIds:ids});
      await load();
      info(`Download manual solicitado: ${result.count} aula(s) selecionada(s) num único ZIP. As restantes não foram incluídas.`,true);
    }else{
      await ask({type:'EXPORT_ALL'});
      await load();
      info('Download manual solicitado para todas as aulas disponíveis.',true);
    }
  }catch(e){info(e.message);}finally{busy=false;updateSelectionControls();}
});
$('merge').addEventListener('click',async()=>{
  const ids=[...selectedLessons];if(ids.length<2 || busy)return;
  if(ids.some(id=>!mergeable(cachedState?.lessons?.find(l=>l.id===id),cachedState))){
    info('Para juntar, marca apenas aulas terminadas com legendas. Podes descarregar uma aula ativa sem fazer merge.');return;
  }
  const lessons=ids.map(id=>cachedState?.lessons?.find(l=>l.id===id));
  if(lessons.some(l=>!l))return;
  if(!lessons.every(l=>l.title.trim().toLowerCase()===lessons[0].title.trim().toLowerCase() && Boolean(l.pageUrl) && l.pageUrl===lessons[0].pageUrl)){
    info('Seleciona apenas capturas do mesmo vídeo (título e URL iguais). Corrige os nomes, se necessário.');return;
  }
  if(!confirm(`Juntar ${ids.length} capturas de «${lessons[0].title}»?\n\nAs falas repetidas nos mesmos instantes serão removidas. Os originais continuam guardados como segurança e ficam excluídos da exportação em lote. Nenhum download será iniciado.`))return;
  busy=true;
  try{const result=await ask({type:'MERGE',lessonIds:ids});
    selectedLessons.clear();await load();
    info(`Merge criado: ${result.uniqueCues} falas únicas; ${result.removed} duplicadas removidas. Descarrega o ZIP consolidado quando quiseres.`,true);
  }catch(e){info(e.message);}finally{busy=false;}
});
$('lessons').addEventListener('click',ev=>{
  const undo=ev.target.closest('button[data-undo]');
  if(undo){if(!confirm('Desfazer esta consolidação? As fontes originais voltarão a ficar disponíveis. Não apaga ZIPs já guardados.'))return;
    work({type:'UNDO_MERGE',lessonId:undo.dataset.undo},'Merge desfeito; fontes restauradas.');return;
  }
  const edit=ev.target.closest('button[data-edit]');
  if(edit){const lesson=cachedState?.lessons?.find(x=>x.id===edit.dataset.edit);if(!lesson)return;
    const title=prompt('Corrigir o título desta aula:',lesson.title);
    if(title?.trim())work({type:'RENAME',lessonId:lesson.id,title:title.trim()},'Título atualizado. Exporta novamente para incluir o novo nome.');return;
  }
  const btn=ev.target.closest('button[data-id]');if(btn)work({type:'EXPORT',lessonId:btn.dataset.id},'Download solicitado por ti.');
});
$('clearEligible').addEventListener('click',async()=>{
  if(busy)return;
  const ids=new Set([...eligibleToClear(cachedState),...eligibleEmpty(cachedState),...eligibleMergeSources(cachedState)].map(l=>l.id));
  if(!ids.size)return;
  if(!confirm(`Limpar ${ids.size} captura(s) elegível(is)?\n\nSerão eliminadas capturas vazias, aulas exportadas sem alterações e fontes de merge já exportados.\nAs aulas ainda não exportadas, a captura ativa e blocos pendentes ficam protegidos.\nOs ZIPs existentes no disco permanecem. Esta limpeza não pode ser anulada.`))return;
  busy=true;
  try{const result=await ask({type:'CLEAR_ELIGIBLE'});await load();info(`${result.removed} captura(s) eliminada(s). ${result.remaining} mantida(s) no armazenamento.`,true);}
  catch(e){info(e.message);}finally{busy=false;}
});
chrome.runtime.onMessage.addListener(()=>load());
load();setInterval(load,2400);
