import {isVttCandidate,isHotmartPage,parseVtt,uniqueCues,slug,exportFormats} from './lib/vtt.js';
import {createZip,binaryBase64} from './lib/zip.js';
import {playbackDecision} from './lib/watchdog.js';
import {probeDebuggerTarget} from './lib/player-probe.js';
import {sameLesson,mergeCues} from './lib/merge.js';
import {checkedSpeed,matchesSpeed,speedLabel,speedExpression} from './lib/speed.js';
import {qualityExpression} from './lib/quality.js';
import {autoQualityDecision,acknowledgeManualQuality} from './lib/quality-scheduler.js';
import {qualityMenuExpression} from './lib/quality-menu.js';
import {hotmartNativeQualityExpression} from './lib/hotmart-native-quality.js';
import {titleProbeExpression,completionExpression} from './lib/lesson-ui.js';
import {previousCaptures,captureStartDecision} from './lib/capture-start.js';

const STORE_KEY='fhad_vtt_capture_v1';
const requests=new Map();
const playerSessions=new Map();
// Contextos padrão do próprio player. Um mundo isolado permite ler <video>,
// mas não permite aceder aos globais hls.js / video.js / JW Player.
const mainWorldContexts=new Map();
// Descarta apenas o evento de detach provocado pela recuperação explícita
// de uma ligação do próprio plugin. Expira rapidamente para não esconder falhas reais.
const recoveryDetachDeadline=new Map();
const lastIconByTab=new Map();
async function updateCaptureIcon(tabId,recording){
  if(!Number.isSafeInteger(tabId)||tabId<0 || !chrome.action?.setIcon)return;
  const next=recording?'red':'blue';
  if(lastIconByTab.get(tabId)===next)return;
  try{await chrome.action.setIcon({tabId,path:{16:`icons/${next}16.png`,48:`icons/${next}48.png`,128:`icons/${next}128.png`}});lastIconByTab.set(tabId,next);}catch{}
}

const contextKey=t=>`${t.tabId}:${t.sessionId||'main'}`;
function trackContext(target,context){
  const frameId=context?.auxData?.frameId;
  if(!frameId||context.auxData?.isDefault!==true||!Number.isSafeInteger(context.id))return;
  const key=contextKey(target);
  if(!mainWorldContexts.has(key))mainWorldContexts.set(key,new Map());
  mainWorldContexts.get(key).set(frameId,context.id);
}
async function clearInactiveBadges(s){
  let tabs=[];try{tabs=await chrome.tabs.query({});}catch{return;}
  await Promise.all(tabs.filter(t=>Number.isSafeInteger(t.id)&&isHotmartPage(t.url)&&(!s.tracking||t.id!==s.tabId))
    .map(async t=>{try{await chrome.action.setBadgeText({tabId:t.id,text:''});await updateCaptureIcon(t.id,false);}catch{}}));
}

const WATCHDOG_ALARM='fhad_vtt_watchdog';
const TITLE_POLL_INTERVAL=3000;
const FINISH_ALARM='fhad_vtt_endcheck';
const SPEED_ALARM='fhad_vtt_speedcheck';
const END_MESSAGE='FHAD_VTT_VIDEO_END:';
const VIDEO_PROBE=`(() => {
  const videos=[];const seen=new Set();
  function scan(root) { if(!root||seen.has(root)) return; seen.add(root);
    for(const v of root.querySelectorAll('video')) videos.push(v);
    for(const el of root.querySelectorAll('*')){
      if(el.shadowRoot)scan(el.shadowRoot);
      if(el.tagName==='IFRAME'){try{scan(el.contentDocument)}catch{}}
    }
  }
  scan(document);
  const scored=videos.map(v=>({v,score:(v.duration&&isFinite(v.duration)?10:0)+(v.readyState>1?5:0)+(!v.paused?10:0)}))
    .sort((a,b)=>b.score-a.score);
  const v=scored[0]?.v; if(!v)return null;
  const source=v.currentSrc||v.src||'video';let id=0;for(let i=0;i<source.length;i++)id=((id<<5)-id+source.charCodeAt(i))|0;
  return {currentTime:v.currentTime,duration:isFinite(v.duration)?v.duration:0,
    paused:v.paused,ended:v.ended,readyState:v.readyState,playbackRate:Number(v.playbackRate),
    trackId:'video-'+(id>>>0).toString(36)};
})()`;
let cache=null;
let chain=Promise.resolve();
const now=()=>new Date().toISOString();
function badgeValue(count){
  const n=Math.max(0,Number(count)||0);
  return n<1000?String(n):n<9950?`${(n/1000).toFixed(1).replace(/\.0$/,'')}k`:'9k+';
}
function updateBadge(s,tabId=s.tabId){
  if(!Number.isSafeInteger(tabId)||tabId<0)return;
  const lesson=currentLesson(s);
  const count=lesson?.segments||0;
  chrome.action.setBadgeText({tabId,text:s.tracking?badgeValue(count):''}).catch(()=>{});
  updateCaptureIcon(tabId,Boolean(s.tracking&&s.tabId===tabId));
  chrome.action.setBadgeBackgroundColor({tabId,color:s.tracking&&s.tabId===tabId?'#B72E35':'#236DB3'}).catch(()=>{});
  if(typeof chrome.action.setTitle==='function')
    chrome.action.setTitle({tabId,title:s.tracking?`FHAD VTT Capture · ${count} bloco(s) VTT · ${lesson?.cues?.length||0} fala(s) · ${lesson?.title||''}`:'FHAD VTT Capture'}).catch(()=>{});
}

const cleanUrl=(url)=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return '';}};
const addLog=(state,text)=>{state.log=[{when:now(),text},...(state.log||[])].slice(0,25);};
const errMsg=(e)=>String(e?.message || e).slice(0,350);
const emptyState=()=>({tracking:false,tabId:null,currentId:null,signature:null,finishedSignature:null,autoRecover:true,playback:null,lastSegmentAt:null,
  playbackSpeed:6,speedStatus:null,qualityMinOnCapture:true,qualityStatus:null,qualityAuto:null,
  routeUrl:null,routePending:null,lessons:[],log:[],lastError:null,captureErrors:0,startedAt:null});
async function readState(){if(cache)return cache;const stored=await chrome.storage.local.get(STORE_KEY);cache=stored[STORE_KEY]||emptyState();return cache;}
async function saveState(state){await chrome.storage.local.set({[STORE_KEY]:state});}
function serial(task,persist=true){const next=chain.then(async()=>{const s=await readState();const result=await task(s);if(persist)await saveState(s);return result;});chain=next.catch(()=>{});return next;}
function findLesson(s,id){return s.lessons.find(x=>x.id===id);}
function currentLesson(s){return findLesson(s,s.currentId);}
function createLesson(s,meta,reason='início'){
  const lesson={id:crypto.randomUUID(),course:meta.course||'Hotmart',title:meta.title||'Aula sem título',
    confidence:meta.confidence||'baixa',pageUrl:cleanUrl(meta.url),signature:meta.signature||'',
    mediaKey:meta.mediaKey||'',startedAt:now(),endedAt:null,segments:0,cues:[],
    timestampMaps:[],streamHosts:[],warnings:[],exportedSegments:0,downloadId:null,exportStatus:'',overlapWarnings:0,completionStatus:'A aguardar fim do vídeo',completedOnPlatform:false};
  if(lesson.confidence!=='alta')lesson.warnings.push('Identificação automática da aula deve ser confirmada');
  s.lessons.push(lesson);s.currentId=lesson.id;s.signature=lesson.signature;s.finishedSignature=null;s.playback=null;s.endedObserved=null;s.qualityAuto=null;
  if(s.qualityMinOnCapture){
    s.qualityStatus={status:'A aguardar o player para reduzir qualidade',applied:false,at:0,lessonId:lesson.id};
  }
  if(s.playbackSpeed>1){
    s.speedStatus={requested:s.playbackSpeed,applied:null,status:'A aguardar o player da nova aula',lessonId:lesson.id,at:0};
    chrome.alarms.create(SPEED_ALARM,{when:Date.now()+2500}).catch(()=>{});
  }
  // Alarmes são apenas fallback: o evento 'playing' de cada iframe inicia a
  // seleção de qualidade assim que o vídeo está pronto.
  if(s.qualityMinOnCapture)chrome.alarms.create(SPEED_ALARM,{when:Date.now()+2500}).catch(()=>{});
  addLog(s,`Aula iniciada: ${lesson.title} (${reason})`);updateBadge(s);return lesson;
}
function markEnded(s,reason){
  const lesson=currentLesson(s);if(!lesson)return null;
  if(!lesson.endedAt)lesson.endedAt=now();
  s.currentId=null;
  s.finishedSignature=lesson.signature;
  s.playback=null;s.endedObserved=null;
  addLog(s,`Aula terminada: ${lesson.title} (${reason})`);
  return lesson;
}
function metadataSignature(meta){return `${cleanUrl(meta.url)}|${String(meta.title||'').trim().toLowerCase()}`;}
// Cada URL de conteúdo Hotmart é uma fronteira de aula. A navegação SPA chega
// antes de o React substituir o <h1>; nunca esperar pelo título para fechar a
// captura anterior. O novo stream começa numa aula provisória, separada.
function onRouteChanged(s,tabId,rawUrl,source='navegação'){
  if(!allowedTab(s,tabId))return false;
  const url=cleanUrl(rawUrl);
  if(!isHotmartPage(url))return false;
  const previousUrl=s.routeUrl || currentLesson(s)?.pageUrl || '';
  if(previousUrl===url){s.routeUrl=url;return false;}
  const previous=currentLesson(s);
  const oldTitle=previous?.title||'';
  const course=previous?.course||'Hotmart';
  // Primeiro arranque: a URL inicial foi lida antes do redirecionamento do
  // player. Um placeholder 0/0 sem identidade pode ser aproveitado em segurança.
  const reuse=previous && previous.title==='Aula sem título' && previous.segments===0 &&
    !previous.cues?.length && !s.routePending;
  if(previous && !reuse)finishCurrent(s,`mudança de URL (${source})`);
  s.routeUrl=url;
  if(reuse){
    previous.pageUrl=url;previous.signature=metadataSignature({url,title:'Aula sem título'});
    s.signature=previous.signature;
  }else createLesson(s,normalizedMeta({url,title:'Aula sem título',course,confidence:'baixa'}),`nova URL (${source})`);
  s.routePending={url,previousTitle:reuse?'':oldTitle,since:Date.now()};
  addLog(s,`Nova aula detetada pela URL. A aguardar título; segmentos novos isolados da anterior.`);
  return true;
}
// A URL real do separador é a autoridade: mensagens tardias de um content
// script ou uma navegação em atraso não podem fazer regressar à aula anterior.
async function syncTabRoute(s,tabId,fallbackUrl=''){
  let url='';
  try{const tab=await chrome.tabs.get(tabId);url=cleanUrl(tab?.url);}catch{}
  if(!isHotmartPage(url))url=cleanUrl(fallbackUrl);
  if(isHotmartPage(url))onRouteChanged(s,tabId,url,'URL do Brave');
  return url;
}

function normalizedMeta(meta={}){
  const title=String(meta.title||'').replace(/\s+/g,' ').trim().slice(0,160);
  return {url:cleanUrl(meta.url),title:title||'Aula sem título',course:String(meta.course||'Hotmart').slice(0,120),
    confidence:['alta','média','baixa'].includes(meta.confidence)?meta.confidence:'baixa',
    mediaKey:String(meta.mediaKey||'').slice(0,220),signature:metadataSignature(meta)};
}
function fileEntry(lesson){
  const formats=exportFormats(lesson);
  const folder=slug(lesson.course,50);
  const base=`${slug(lesson.title,80)}_${lesson.startedAt.slice(0,10)}_${lesson.id.slice(0,8)}`;
  return {folder,base,files:{
    [base+'.vtt']:formats.vtt,
    [base+'.txt']:formats.txt,
    [base+'.md']:formats.md,
    [base+'.metadata.json']:formats.json
  }};
}
async function manualDownload(s,zip,filename,lessons){
  const url='data:application/zip;base64,'+binaryBase64(zip);
  // Única via para pedir ao Brave um download: botões explícitos no popup.
  // saveAs:true mostra o seletor de ficheiro nesta ação voluntária.
  const id=await chrome.downloads.download({url,filename,conflictAction:'uniquify',saveAs:true});
  for(const lesson of lessons){
    lesson.downloadId=id;
    lesson.exportStatus='a descarregar';
    lesson.exportedSegments=lesson.segments;
    lesson.exportedTitle=lesson.title;
    lesson.exportedCourse=lesson.course;
    lesson.exportedCues=lesson.cues.length;
  }
  addLog(s,`Download manual solicitado (${lessons.length} aula(s)).`);
  return {id,filename};
}
async function downloadLesson(s,lesson){
  if(lesson?.supersededBy)throw Error('Esta captura já está integrada num merge. Descarrega a transcrição consolidada ou desfaz o merge.');
  if(!lesson?.cues?.length)return {skip:'Sem legendas WEBVTT'};
  const {folder,base,files}=fileEntry(lesson);
  try{
    return await manualDownload(s,createZip(files),`FHAD-Legendas/${folder}/${base}.zip`,[lesson]);
  }catch(e){
    lesson.exportStatus='erro';s.lastError=`Falha no download de ${lesson.title}: ${errMsg(e)}`;
    addLog(s,s.lastError);throw e;
  }
}
// Uma seleção deve ser explícita, sem aulas repetidas, vazias ou fontes de merge.
// A seleção nunca implica consolidação nem altera as transcrições armazenadas.
function validatedExportSelection(s, requestedIds){
  if(!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.length>200 ||
     requestedIds.some(id=>typeof id!=='string') || new Set(requestedIds).size!==requestedIds.length)
    throw Error('Seleciona entre 1 e 200 aulas diferentes para descarregar.');
  const selected=requestedIds.map(id=>findLesson(s,id));
  if(selected.some(l=>!l))throw Error('Uma aula selecionada deixou de existir. Atualiza a lista.');
  if(selected.some(l=>l.supersededBy))throw Error('Uma aula selecionada já pertence a um merge. Descarrega a versão consolidada.');
  if(selected.some(l=>!l.cues?.length))throw Error('A seleção contém aulas sem legendas. Retira-as da seleção.');
  // Ordem cronológica estável, mesmo que a seleção seja feita na ordem inversa no popup.
  const ids=new Set(requestedIds);
  return s.lessons.filter(l=>ids.has(l.id));
}
async function downloadSelectedLessons(s, requestedIds){
  const selected=validatedExportSelection(s,requestedIds);
  return downloadSelectedLessonsWithName(s,selected,`FHAD-Legendas/Aulas-selecionadas_${now().replace(/[:.]/g,'-')}.zip`);
}
async function downloadAllLessons(s){
  const selected=s.lessons.filter(l=>l.cues?.length && !l.supersededBy);
  if(!selected.length)return {count:0,skip:'Sem legendas WEBVTT'};
  return downloadSelectedLessonsWithName(s,selected,`FHAD-Legendas/Todas-as-aulas_${now().replace(/[:.]/g,'-')}.zip`);
}
async function downloadSelectedLessonsWithName(s,selected,filename){
  const files={};
  for(const lesson of selected){
    const {folder,base,files:entries}=fileEntry(lesson);
    for(const [name,data] of Object.entries(entries))files[`${folder}/${base}/${name}`]=data;
  }
  try{
    const result=await manualDownload(s,createZip(files),filename,selected);
    return {...result,count:selected.length};
  }catch(e){
    s.lastError=`Falha ao descarregar as aulas: ${errMsg(e)}`;
    addLog(s,s.lastError);throw e;
  }
}
// A consolidação é sempre uma ação manual, anterior à exportação.
// As fontes são preservadas e excluídas de «Descarregar todas» até o utilizador
// descarregar/confirmar o merge; assim não gera ZIPs repetidos.
function mergeLessons(s, requestedIds){
  if(!Array.isArray(requestedIds)||requestedIds.length<2||requestedIds.length>20 ||
     new Set(requestedIds).size!==requestedIds.length || requestedIds.some(id=>typeof id!=='string'))
    throw Error('Seleciona entre 2 e 20 capturas diferentes para juntar.');
  const sources=requestedIds.map(id=>findLesson(s,id));
  if(sources.some(l=>!l))throw Error('Uma das capturas selecionadas não existe. Atualiza o painel.');
  if(sources.some(l=>l.id===s.currentId || !l.endedAt || l.supersededBy ||
      [...requests.values()].some(r=>r.lessonId===l.id)))
    throw Error('Para juntar, termina primeiro a captura e aguarda os segmentos pendentes. Capturas já integradas noutro merge não podem ser selecionadas.');
  if(sources.some(l=>!l.cues?.length))throw Error('Só é possível juntar capturas com legendas. Usa «Limpar capturas vazias» para as restantes.');
  if(sources.some(l=>!sameLesson(sources[0],l)))
    throw Error('As capturas têm de ter o mesmo título e URL da aula. Não juntamos automaticamente vídeos potencialmente diferentes.');
  const combined=mergeCues(sources);
  const originalCount=sources.reduce((n,l)=>n+l.cues.length,0);
  const first=sources[0];
  const course=sources.find(l=>l.course && l.course.toLowerCase()!=='hotmart')?.course||first.course;
  const unique=[...new Set(sources.flatMap(l=>l.warnings||[]))];
  if(new Set(sources.map(l=>String(l.course||'').toLowerCase())).size>1)
    unique.push('Capturas indicavam nomes de curso diferentes; verificar metadados após o merge');
  if(sources.some(l=>(l.timestampMaps||[]).length>1))
    unique.push('Vários mapas de tempo: confirmar sincronização dos segmentos após o merge');
  const lesson={id:crypto.randomUUID(),course,title:first.title,confidence:sources.every(l=>l.confidence==='alta')?'alta':'média',
    pageUrl:first.pageUrl,signature:first.signature||'',mediaKey:first.mediaKey||'',
    startedAt:sources.map(l=>l.startedAt).filter(Boolean).sort()[0]||now(),
    endedAt:sources.map(l=>l.endedAt).filter(Boolean).sort().at(-1)||now(),
    segments:sources.reduce((n,l)=>n+(l.segments||0),0),cues:combined.cues,
    timestampMaps:[...new Set(sources.flatMap(l=>l.timestampMaps||[]))],
    streamHosts:[...new Set(sources.flatMap(l=>l.streamHosts||[]))],
    warnings:unique,exportedSegments:0,downloadId:null,exportStatus:'',overlapWarnings:0,
    mergedAt:now(),sourceIds:[...new Set(sources.flatMap(l=>l.sourceIds?.length?l.sourceIds:[l.id]))],
    mergeSources:requestedIds,mergeInputCues:originalCount,mergeRemovedCues:combined.removed};
  for(const l of sources)l.supersededBy=lesson.id;
  s.lessons.push(lesson);
  addLog(s,`Merge manual «${lesson.title}»: ${sources.length} capturas, ${combined.removed} falas duplicadas removidas, ${lesson.cues.length} falas únicas. Fontes guardadas.`);
  return {mergedId:lesson.id,sourceCount:sources.length,removed:combined.removed,uniqueCues:lesson.cues.length};
}
function undoMerge(s,lessonId){
  const merged=findLesson(s,lessonId);
  if(!merged?.mergeSources?.length || merged.supersededBy)throw Error('Merge não encontrado ou já integrado noutro merge.');
  const sources=merged.mergeSources.map(id=>findLesson(s,id));
  if(sources.some(l=>!l || l.supersededBy!==merged.id))
    throw Error('Não é possível desfazer: algumas fontes já foram eliminadas ou modificadas.');
  for(const source of sources)delete source.supersededBy;
  s.lessons=s.lessons.filter(l=>l.id!==merged.id);
  addLog(s,`Merge «${merged.title}» desfeito; ${sources.length} fontes recuperadas. ZIPs já guardados no disco não são apagados.`);
  return {restored:sources.length};
}
// Só permite limpar fontes após download concluído da transcrição consolidada,
// e se nenhuma fonte estiver em captura ou tiver respostas de rede pendentes.
function clearMergedSources(s,ids){
  if(!Array.isArray(ids)||!ids.length)throw Error('Não existem fontes de merge prontas para limpar.');
  const eligible=s.lessons.filter(l=>ids.includes(l.id)&&l.supersededBy && l.id!==s.currentId &&
    ![...requests.values()].some(r=>r.lessonId===l.id) &&
    canClearLesson(s,findLesson(s,l.supersededBy)));
  const removed=new Set(eligible.map(l=>l.id));
  s.lessons=s.lessons.filter(l=>!removed.has(l.id));
  if(removed.size)addLog(s,`${removed.size} fonte(s) de merges exportados removida(s), mediante confirmação; merges consolidados preservados.`);
  return {removed:removed.size,skipped:ids.length-removed.size};
}
// Só se pode limpar dados cujo ZIP teve download concluído.
// Nunca apagar a aula ativa, exportações incompletas ou capturas entretanto alteradas.
// As versões antigas podem não ter exportedTitle/exportedCues, por isso nesses
// casos verificamos o contador de segmentos disponibilizado pela v0.3.0.
function canClearLesson(s,lesson){
  if(!lesson || lesson.id===s.currentId || !lesson.endedAt || lesson.supersededBy)return false;
  if(lesson.exportStatus!=='concluído' || !lesson.cues?.length)return false;
  if(!Number.isInteger(lesson.exportedSegments) || lesson.exportedSegments!==lesson.segments)return false;
  if(lesson.exportedCues!==undefined && lesson.exportedCues!==lesson.cues.length)return false;
  if(lesson.exportedTitle!==undefined && lesson.exportedTitle!==lesson.title)return false;
  if(lesson.exportedCourse!==undefined && lesson.exportedCourse!==lesson.course)return false;
  // Há um segmento pendente: aguardar pela sua gravação e eventual reexportação.
  if([...requests.values()].some(r=>r.lessonId===lesson.id))return false;
  return true;
}
function canClearEmptyLesson(s,lesson){
  // Capturas sem qualquer legenda podem ser apagadas sem download.
  // Não apagar a aula corrente nem respostas WEBVTT ainda a chegar.
  return Boolean(lesson && lesson.id!==s.currentId && lesson.segments===0 &&
    Array.isArray(lesson.cues) && lesson.cues.length===0 &&
    ![...requests.values()].some(r=>r.lessonId===lesson.id));
}
function clearEmptyLessons(s,requestedIds){
  if(!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.some(id=>typeof id!=='string'))
    throw Error('Seleciona capturas vazias antes de limpar.');
  const allowed=new Set(requestedIds);
  const removable=s.lessons.filter(l=>allowed.has(l.id) && canClearEmptyLesson(s,l));
  const ids=new Set(removable.map(l=>l.id));
  if(ids.size){
    s.lessons=s.lessons.filter(l=>!ids.has(l.id));
    addLog(s,`${ids.size} captura(s) sem segmentos nem falas removida(s) manualmente.`);
  }
  return {removed:ids.size,skipped:allowed.size-ids.size};
}
function clearExportedLessons(s,requestedIds){
  if(!Array.isArray(requestedIds) || !requestedIds.length || requestedIds.some(id=>typeof id!=='string'))
    throw Error('Seleciona aulas descarregadas antes de limpar.');
  const allowed=new Set(requestedIds);
  const removable=s.lessons.filter(l=>allowed.has(l.id) && canClearLesson(s,l));
  const removedIds=new Set(removable.map(l=>l.id));
  if(removedIds.size){
    s.lessons=s.lessons.filter(l=>!removedIds.has(l.id));
    addLog(s,`${removedIds.size} aula(s) já descarregada(s) eliminada(s) do armazenamento local; ficheiros ZIP preservados.`);
  }
  return {removed:removedIds.size,skipped:allowed.size-removedIds.size};
}
// Limpeza unificada: todos os registos que seja seguro eliminar, sem risco
// de apagar uma aula em captura, dados sem download ou blocos pendentes.
function canClearMergedSource(s,lesson){
  return Boolean(lesson?.supersededBy && lesson.id!==s.currentId &&
    ![...requests.values()].some(r=>r.lessonId===lesson.id) &&
    canClearLesson(s,findLesson(s,lesson.supersededBy)));
}
function clearEligible(s){
  const victims=s.lessons.filter(l=>canClearEmptyLesson(s,l)||canClearLesson(s,l)||canClearMergedSource(s,l));
  const ids=new Set(victims.map(l=>l.id));
  if(ids.size){
    s.lessons=s.lessons.filter(l=>!ids.has(l.id));
    addLog(s,`${ids.size} captura(s) elegível(is) eliminada(s) numa única limpeza manual. ZIPs no disco preservados.`);
  }
  return {removed:ids.size,remaining:s.lessons.length};
}
// Recolhe o título atual diretamente do content script; se este estiver
// inoperacional, tenta ler o <h1> no mundo principal da página com CDP.
// Não impede a captura WEBVTT quando falha.
async function ensureLessonTitle(s,force=false){
  if(!s.tracking||!s.currentId)return false;
  const lesson=currentLesson(s);
  if(!lesson || (!force && lesson.title!=='Aula sem título' && !s.routePending))return false;
  if(!force && Date.now()-Number(s.lastTitleProbeAt||0)<TITLE_POLL_INTERVAL)return false;
  s.lastTitleProbeAt=Date.now();
  let meta=null;
  try{
    const response=await chrome.tabs.sendMessage(s.tabId,{type:'READ_METADATA'});
    if(response?.ok && response.meta?.confidence!=='baixa' && response.meta?.title!=='Aula sem título')meta=response.meta;
  }catch{}
  if(!meta){
    try{
      const result=await chrome.debugger.sendCommand({tabId:s.tabId},'Runtime.evaluate',{
        expression:titleProbeExpression(),returnByValue:true});
      const value=result?.result?.value;
      if(value?.title)meta={...value,course:lesson.course||'Hotmart'};
    }catch{}
  }
  if(!meta && chrome.scripting?.executeScript){
    try{
      const results=await chrome.scripting.executeScript({target:{tabId:s.tabId},world:'MAIN',func:()=>{
        const visited=new Set(),rootList=[];
        function walk(root){if(!root||visited.has(root))return;visited.add(root);rootList.push(root);for(const el of root.querySelectorAll('*'))if(el.shadowRoot)walk(el.shadowRoot);}
        walk(document);
        for(const selector of ['h1.text-2xl','h1[class*="text-2xl"]','main h1','h1'])for(const root of rootList){
          for(const el of root.querySelectorAll(selector)){
            const title=(el.textContent||'').replace(/\s+/g,' ').trim();
            if(el.getClientRects().length && title.length>4 && title.length<160)return {title,url:location.href,confidence:'alta'};
          }
        }
        return null;
      }});
      if(results?.[0]?.result?.title)meta={...results[0].result,course:lesson.course||'Hotmart'};
    }catch(e){addLog(s,'Leitura alternativa do título indisponível: '+errMsg(e));}
  }
  if(!meta)return false;
  const oldTitle=lesson.title;
  await onMetadata(s,s.tabId,meta);
  return Boolean(currentLesson(s)?.title!==oldTitle && currentLesson(s)?.title!=='Aula sem título');
}
// A conclusão nunca se baseia na simples ausência de novas legendas.
// Só um evento ended do vídeo (na aula atual) ou o seu progresso real até ao
// fim pode autorizar o clique de Concluir, com dupla verificação de URL/título.
async function markLessonViewed(s,probe){
  if(!s.tracking||!s.currentId)return false;
  let lesson=currentLesson(s);
  if(!lesson||lesson.completedOnPlatform)return false;
  if(lesson.title==='Aula sem título')await ensureLessonTitle(s,true);
  lesson=currentLesson(s);
  if(!lesson||lesson.title==='Aula sem título')return false;
  const actualUrl=await syncTabRoute(s,s.tabId);
  if(!actualUrl||actualUrl!==lesson.pageUrl)return false;
  const ended=Boolean(probe?.ended || (Number(probe?.duration)>0 && probe?.paused &&
    Number(probe.currentTime)>=Number(probe.duration)-0.8));
  const eventEnded=Boolean(s.endedObserved?.lessonId===lesson.id &&
    Date.now()-s.endedObserved.at<60000);
  if(!ended&&!eventEnded)return false;
  if(lesson.completionRequestedAt && Date.now()-lesson.completionRequestedAt<12000)return false;
  lesson.completionRequestedAt=Date.now();
  try{
    const r=await chrome.debugger.sendCommand({tabId:s.tabId},'Runtime.evaluate',{
      expression:completionExpression(lesson.pageUrl,lesson.title),returnByValue:true,userGesture:true});
    const outcome=r?.result?.value;
    lesson.completionStatus=outcome?.status||'Não foi possível confirmar a conclusão';
    if(outcome?.confirmed){lesson.completedOnPlatform=true;lesson.platformCompletedAt=now();}
    if(outcome?.clicked)addLog(s,'Botão Concluir acionado na Hotmart: '+lesson.title);
    if(!outcome?.ok)addLog(s,'Conclusão pendente: '+lesson.completionStatus);
    return Boolean(outcome?.ok);
  }catch(e){lesson.completionStatus='Conclusão indisponível: '+errMsg(e);return false;}
}
// O fecho de uma aula só muda o estado persistido em chrome.storage.local.
// Downloads nunca são iniciados por transições, alarmes, paragem ou reinício.
// O único caminho para chrome.downloads.download é a ação manual EXPORT/EXPORT_SELECTED/EXPORT_ALL.
function finishCurrent(s,reason){
  return markEnded(s,reason);
}
function allowedTab(s,tabId){return s.tracking && s.tabId===tabId;}
async function onMetadata(s,tabId,raw){
  if(!allowedTab(s,tabId))return;
  const meta=normalizedMeta(raw);
  if(!isHotmartPage(meta.url))return;
  const route=await syncTabRoute(s,tabId,meta.url);
  // Ignorar metadados da página antiga, enviados depois da troca de aula.
  if(route && meta.url!==route)return;
  if(meta.url!==s.routeUrl)onRouteChanged(s,tabId,meta.url,'metadados');
  let lesson=currentLesson(s);
  if(!lesson){
    if(s.finishedSignature===meta.signature)return;
    createLesson(s,meta,'metadados da página');return;
  }
  const pending=s.routePending?.url===meta.url?s.routePending:null;
  if(pending){
    if(meta.confidence==='baixa' || meta.title==='Aula sem título' ||
       (pending.previousTitle && meta.title===pending.previousTitle)){
      // Em mudanças SPA, o <h1> antigo continua visível durante alguns frames.
      // Nunca atribuir essa identidade à nova aula. O utilizador pode confirmar
      // manualmente se o novo vídeo tiver realmente o mesmo título.
      return;
    }
    lesson.title=meta.title;lesson.course=meta.course==='Hotmart'?lesson.course:meta.course;
    lesson.confidence=meta.confidence;lesson.pageUrl=meta.url;
    lesson.signature=meta.signature;lesson.mediaKey=meta.mediaKey||lesson.mediaKey;
    s.signature=meta.signature;s.routePending=null;
    if(lesson.confidence==='alta')lesson.warnings=lesson.warnings.filter(w=>!w.includes('Identificação automática'));
    addLog(s,`Título confirmado para a nova aula: ${lesson.title}`);
    return;
  }
  // O placeholder de início pode receber o título mesmo após o primeiro VTT.
  if(lesson.title==='Aula sem título'){
    if(meta.title==='Aula sem título' || meta.confidence==='baixa')return;
    lesson.title=meta.title;lesson.confidence=meta.confidence;lesson.course=meta.course;
    lesson.pageUrl=meta.url;lesson.signature=meta.signature;s.signature=meta.signature;
    lesson.mediaKey=meta.mediaKey||lesson.mediaKey;
    if(lesson.confidence==='alta')lesson.warnings=lesson.warnings.filter(w=>!w.includes('Identificação automática'));
    return;
  }
  // Mesmo URL, título realmente diferente: SPA pode reciclar a rota/URL.
  // É necessário observar <h1> estável com confiança alta.
  if(meta.signature!==lesson.signature && meta.confidence==='alta' && meta.title!==lesson.title){
    finishCurrent(s,'título alterado na mesma URL');
    createLesson(s,meta,'novo título');return;
  }
  if(meta.mediaKey)lesson.mediaKey=meta.mediaKey;
  if(meta.confidence==='alta' && lesson.confidence!=='alta'){
    lesson.confidence='alta';
    lesson.warnings=lesson.warnings.filter(w=>!w.includes('Identificação automática'));
  }
}
async function recordSegment(s, tabId,info,body){
  if(!allowedTab(s,tabId))return;
  const decoded=body?.base64Encoded?new TextDecoder('utf-8').decode(Uint8Array.from(atob(body.body||''),c=>c.charCodeAt(0))):body?.body;
  const parsed=parseVtt(decoded);if(!parsed.valid || !parsed.cues.length)return;
  // Não fazer fallback para a aula atual: um request com identidade perdida
  // nunca deve contaminar a transcrição de outra aula.
  let lesson=info.lessonId?findLesson(s,info.lessonId):null;
  if(!lesson){s.captureErrors++;addLog(s,'WEBVTT sem aula ativa: segmento ignorado');return;}
  // Recusamos novos segmentos atribuídos a uma aula após já existir outra identificação.
  // Respostas que começaram na aula anterior mantêm o id registado em responseReceived.
  const oldCount=lesson.cues.length;
  const oldKeys=new Set(lesson.cues.map(c=>`${c.start}|${c.end}|${c.text}`));
  for(const cue of parsed.cues){
    const key=`${cue.start}|${cue.end}|${cue.text}`;
    if(!oldKeys.has(key)){lesson.cues.push({...cue,index:lesson.cues.length});oldKeys.add(key);}
  }
  lesson.segments++;
  s.lastSegmentAt=now();
  lesson.lastSegmentAt=s.lastSegmentAt;
  const tmap=parsed.map?`${parsed.map.mpegts}/${parsed.map.local}`:null;
  if(tmap && !lesson.timestampMaps.includes(tmap)){
    if(lesson.timestampMaps.length<30)lesson.timestampMaps.push(tmap);
    if(!lesson.warnings.includes('Segmentos com X-TIMESTAMP-MAP: confirmar alinhamento temporal'))lesson.warnings.push('Segmentos com X-TIMESTAMP-MAP: confirmar alinhamento temporal');
  }
  try{const host=new URL(info.url).hostname;if(!lesson.streamHosts.includes(host))lesson.streamHosts.push(host);}catch{}
  if(lesson.cues.length>oldCount)lesson.cues=uniqueCues(lesson.cues);
  updateBadge(s,tabId);
  if(!lesson.cues.length)addLog(s,'Foi recebido um segmento sem falas reconhecidas');
}
// A janela popup não é a sessão CDP: abrir/fechar o popup não pode alterar
// a captura. Se o worker recuperar um estado antigo, consultar a ligação
// *da própria extensão* antes de apresentar PARADO ou reanexar ao vídeo.
// getTargets().attached, isoladamente, NÃO comprova que o debugger nos pertence:
// DevTools e outras extensões também podem estar ligados.
async function ownsDebuggerSession(tabId){
  if(!Number.isSafeInteger(tabId)||tabId<0)return false;
  // Runtime.evaluate pode falhar transitoriamente ao mudar de aula (contexto
  // JavaScript destruído), apesar de a ligação CDP continuar viva. Runtime.enable
  // não depende da existência de um execution context. O Brave recusa o comando
  // quando a ligação NÃO pertence a esta extensão: nunca recuperamos outra sessão.
  try{await chrome.debugger.sendCommand({tabId},'Runtime.enable',{});return true;}
  catch{return false;}
}
async function reconcileCaptureSession(s,preferredTabId=null){
  // Se o estado já diz A GRAVAR, não procurar outros separadores e não
  // modificar a captura durante a simples abertura do popup.
  if(s.tracking)return false;
  let candidates=[];
  if(typeof chrome.debugger.getTargets==='function'){
    try{
      const targets=await chrome.debugger.getTargets();
      const attachedTargets=targets.filter(t=>t.attached);
      // getTargets pode omitir/atrasar a entrada do tab durante navegação SPA.
      // A falta de 'attached' NÃO prova ausência: consultar o nosso próprio
      // debugger com Runtime.enable no separador conhecido/ativo.
      candidates=attachedTargets.filter(t=>Number.isSafeInteger(t.tabId) &&
        (isHotmartPage(t.url)||t.tabId===preferredTabId)).map(t=>({id:t.tabId,url:t.url}));
      if(!candidates.length){
        // Um target do iframe pode não ter tabId, apesar de pertencer à aula.
        // Só se investigam abas ativas se existe ao menos um alvo attached.
        try{const tabs=await chrome.tabs.query({active:true});
          candidates.push(...tabs.filter(t=>Number.isSafeInteger(t.id)&&isHotmartPage(t.url)));
        }catch{}
      }
    }catch(e){addLog(s,'Não foi possível consultar as sessões CDP: '+errMsg(e));}
  }
  // Alguns navegadores não incluem o tabId na lista de alvos. Uma chamada
  // CDP direta ao separador conhecido confirma se a ligação é nossa.
  if(!candidates.length && !Number.isSafeInteger(preferredTabId) && !Number.isSafeInteger(s.tabId)){
    try{const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
      candidates.push(...tabs.filter(t=>Number.isSafeInteger(t.id)&&isHotmartPage(t.url)));
    }catch{}
  }
  if(Number.isSafeInteger(preferredTabId) && !candidates.some(t=>t.id===preferredTabId)){
    try{const t=await chrome.tabs.get(preferredTabId);if(isHotmartPage(t.url))candidates.unshift(t);}catch{}
  }
  if(Number.isSafeInteger(s.tabId) && !candidates.some(t=>t.id===s.tabId)){
    try{const t=await chrome.tabs.get(s.tabId);if(isHotmartPage(t.url))candidates.unshift(t);}catch{}
  }
  for(const tabCandidate of candidates){
    if(!(await ownsDebuggerSession(tabCandidate.id)))continue;
    const tab=await chrome.tabs.get(tabCandidate.id).catch(()=>tabCandidate);
    // Recuperar os dados que já existem. Não eliminar a aula anterior nem
    // criar uma nova quando a sessão CDP é recuperada.
    s.tracking=true;s.tabId=tab.id;s.lastError=null;
    const route=cleanUrl(tab.url);
    const current=findLesson(s,s.currentId);
    const matchesRoute=current && (!route || current.pageUrl===route);
    let resume=matchesRoute&&!current.endedAt?current:null;
    if(!resume)resume=[...s.lessons].reverse().find(l=>!l.endedAt && l.pageUrl===route && !l.supersededBy);
    if(current && !resume && !current.endedAt && route && current.pageUrl!==route)markEnded(s,'URL diferente na recuperação do popup');
    if(resume){s.currentId=resume.id;s.signature=resume.signature||'';}
    else createLesson(s,normalizedMeta({url:tab.url,title:'Aula sem título',course:'Hotmart',confidence:'baixa'}),'sessão CDP recuperada');
    s.routeUrl=route||s.routeUrl;
    s.startedAt=s.startedAt||now();
    try{await chrome.debugger.sendCommand({tabId:tab.id},'Network.enable',{
      maxTotalBufferSize:100000000,maxResourceBufferSize:10000000});}catch{}
    try{await chrome.alarms.create(WATCHDOG_ALARM,{periodInMinutes:0.5});}catch{}
    addLog(s,'Sessão ativa recuperada; popup sincronizado sem reiniciar a captura.');
    s.sessionNotice='Sessão ativa recuperada sem interromper as legendas.';
    updateBadge(s,tab.id);
    chrome.tabs.sendMessage(tab.id,{type:'SCAN'}).catch(()=>{});
    return true;
  }
  return false;
}
// Uma janela popup/side panel pode deixar de reportar o separador ativo depois de
// mudar de foco. Nunca enviar null/undefined ao chrome.tabs.get: a API exige integer.
async function resolveStartTab(tabId){
  let tab=null;
  if(Number.isSafeInteger(tabId) && tabId>=0){
    try{tab=await chrome.tabs.get(tabId);}catch{
      // O separador foi fechado entre a leitura do popup e o clique em Iniciar.
    }
  }
  if(!tab){
    for(const options of [{active:true,lastFocusedWindow:true},{active:true,currentWindow:true}]){
      let candidates=[];
      try{candidates=await chrome.tabs.query(options);}catch{}
      tab=candidates.find(t=>Number.isSafeInteger(t.id) && t.id>=0 && isHotmartPage(t.url));
      if(tab)break;
    }
  }
  if(!tab || !Number.isSafeInteger(tab.id) || tab.id<0)
    throw Error('Não foi possível identificar o separador da Hotmart. Abre a aula, atualiza a página e volta a clicar em Iniciar captura.');
  if(!isHotmartPage(tab.url))throw Error('Abre uma aula Hotmart antes de iniciar a captura.');
  return tab;
}
async function attachDebuggerRecoveringOwnSession(tabId){
  const target={tabId};
  try{await chrome.debugger.attach(target,'1.3');return;}
  catch(error){
    const detail=errMsg(error);
    if(!/already.*attach|another debugger|debugger.*attach|devtools.*open/i.test(detail))
      throw new Error(`O Brave recusou a ligação à captura: ${detail}`);
    // Uma extensão recarregada pode deixar uma ligação CDP órfã. O Chrome só
    // permite detach de ligações geridas por ESTA extensão; não desconecta
    // uma sessão pertencente ao DevTools ou a outra extensão.
    recoveryDetachDeadline.set(tabId,Date.now()+3000);
    try{await chrome.debugger.detach(target);}
    catch(detachError){
      recoveryDetachDeadline.delete(tabId);
      throw new Error('Já existe uma ligação de depuração neste separador. Fecha o DevTools da aula e outras extensões de captura, e volta a tentar. Detalhe: '+errMsg(detachError));
    }
    try{await chrome.debugger.attach(target,'1.3');}
    catch(retryError){
      throw new Error('A ligação de depuração continua ocupada. Fecha o DevTools, atualiza a aula e tenta novamente. Detalhe: '+errMsg(retryError));
    }
  }
}
// Inspeção sem efeitos secundários antes de perguntar ao utilizador.
async function locateCaptureVideo(tabId){
  const inspect=function(){
    const videos=[];const seen=new Set();
    function walk(root){if(!root||seen.has(root))return;seen.add(root);
      for(const v of root.querySelectorAll?.('video')||[]) {
        const r=v.getBoundingClientRect();
        const area=Math.max(0,r.width*r.height);
        if(area<1000 && !v.currentSrc && !v.src)continue;
        const score=Math.min(200,area/5000)+(v.readyState||0)*6+(!v.paused?20:0)+(Number.isFinite(v.duration)&&v.duration>0?18:0);
        videos.push({score,currentTime:Number(v.currentTime)||0,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused});
      }
      for(const el of root.querySelectorAll?.('*')||[])if(el.shadowRoot)walk(el.shadowRoot);
    }
    walk(document);videos.sort((a,b)=>b.score-a.score);return videos[0]||null;
  };
  let results=[];
  try{results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:inspect});}
  catch {results=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:inspect});}
  return results.filter(r=>r.result).map(r=>({...r.result,frameId:r.frameId}))
    .sort((a,b)=>b.score-a.score)[0]||null;
}
// A extensão só inicia a captura depois de verificar o reposicionamento.
async function seekCaptureVideo(tabId,frameId,seconds){
  const seek=async (targetSeconds)=>{
    const videos=[];const seen=new Set();
    function walk(root){if(!root||seen.has(root))return;seen.add(root);
      for(const v of root.querySelectorAll?.('video')||[]){const r=v.getBoundingClientRect();
        const area=Math.max(0,r.width*r.height);
        const score=Math.min(200,area/5000)+(v.readyState||0)*6+(!v.paused?20:0)+(Number.isFinite(v.duration)&&v.duration>0?18:0);
        videos.push({v,score});}
      for(const el of root.querySelectorAll?.('*')||[])if(el.shadowRoot)walk(el.shadowRoot);
    }
    walk(document);videos.sort((a,b)=>b.score-a.score);
    const v=videos[0]?.v;
    if(!v)return {ok:false,reason:'O player HTML5 ainda não está acessível.'};
    const wasPlaying=!v.paused;
    let requested=Math.max(0,Number(targetSeconds)||0);
    if(Number.isFinite(v.duration)&&v.duration>0)requested=Math.min(requested,Math.max(0,v.duration-0.25));
    try {
      v.pause();v.currentTime=requested;
      const started=Date.now();
      while(Date.now()-started<2500 && (v.seeking || Math.abs(v.currentTime-requested)>1.0))
        await new Promise(resolve=>setTimeout(resolve,80));
      const actual=Number(v.currentTime);
      const ok=Number.isFinite(actual)&&Math.abs(actual-requested)<=1.0&&!v.seeking;
      if(wasPlaying)try{await v.play();}catch{}
      return {ok,requested,actual,wasPlaying,reason:ok?'Posição verificada':'O player não confirmou a posição solicitada.'};
    } catch(e) {
      if(wasPlaying)try{await v.play();}catch{}
      return {ok:false,reason:String(e?.message||e)};
    }
  };
  const results=await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},func:seek,args:[seconds]});
  return results?.[0]?.result || {ok:false,reason:'O Brave não devolveu confirmação do reposicionamento.'};
}
async function prepareCaptureStart(s,tabId){
  const tab=await resolveStartTab(tabId);
  const video=await locateCaptureVideo(tab.id).catch(()=>null);
  return {tabId:tab.id,url:cleanUrl(tab.url),video:video?{currentTime:video.currentTime,duration:video.duration,paused:video.paused}:null,
    matches:previousCaptures(s.lessons,tab.url)};
}

async function start(s,tabId,mode='fresh',resumeLessonId=null){
  const tab=await resolveStartTab(tabId);
  tabId=tab.id;
  if(s.tracking){
    if(s.tabId===tabId)return;
    await stop(s,'mudança de separador');
  }
  // Evitar que Iniciar desanexe uma ligação que já está efetivamente ativa.
  // Isto pode acontecer quando o popup mostra um estado antigo após reinício
  // do service worker, mas a captura CDP permanece no Brave.
  if(await reconcileCaptureSession(s,tabId))return;
  // Validar na mesma operação a URL e a escolha. Não confiar no estado do popup.
  const decision=captureStartDecision(s.lessons,tab.url,mode,resumeLessonId);
  const player=await locateCaptureVideo(tabId).catch(()=>null);
  if(!player)throw Error('Não foi possível localizar o vídeo. Espera o player carregar e volta a iniciar a captura.');
  let attached=false;
  let startupLessonId=null;
  let resumeBackup=null;
  try{
    await attachDebuggerRecoveringOwnSession(tabId);
    attached=true;
    await chrome.debugger.sendCommand({tabId},'Network.enable', {maxTotalBufferSize:100000000,maxResourceBufferSize:10000000});
    await chrome.debugger.sendCommand({tabId},'Page.enable',{}).catch(()=>{});
    await chrome.debugger.sendCommand({tabId},'Runtime.enable',{}).catch(()=>{});
    await chrome.debugger.sendCommand({tabId},'Target.setAutoAttach', {
      autoAttach:true,waitForDebuggerOnStart:false,flatten:true,
      filter:[{type:'iframe',exclude:false}]
    });
    // A captura de rede já está ligada neste ponto. Supervisão e melhorias
    // opcionais não podem impedir o arranque da captura VTT.
    s.tracking=true;s.tabId=tabId;s.startedAt=now();s.lastError=null;s.sessionNotice=null;s.currentId=null;s.finishedSignature=null;s.signature=null;
    s.routeUrl=cleanUrl(tab.url);s.routePending=null;
    if(typeof s.autoRecover!=='boolean')s.autoRecover=true;
    s.qualityMinOnCapture=true; // configuração inicial exigida: menor resolução disponível
    s.qualityStatus={status:s.qualityMinOnCapture?'À espera da primeira aula':'Desativada',applied:false,at:0};
    s.playbackSpeed=6;s.speedStatus={requested:6,applied:null,status:'6× por defeito · a aguardar o player',at:Date.now()};
    playerSessions.clear();mainWorldContexts.clear();
    try{await chrome.alarms.create(WATCHDOG_ALARM,{periodInMinutes:0.5});}
    catch(e){addLog(s,'Aviso: supervisor indisponível; as legendas continuam a ser capturadas: '+errMsg(e));}
    // Primeiro verificar a posição com o player pausado. Os eventos de rede
    // ficam em fila até esta operação terminar; uma falha não cria capturas.
    const rewind=await seekCaptureVideo(tabId,player.frameId,decision.seconds);
    if(!rewind.ok)throw Error(`Não foi possível confirmar o início do vídeo (${rewind.reason||'posição não confirmada'}). Nenhuma nova captura foi iniciada.`);
    if(decision.kind==='resume'){
      const old=findLesson(s,decision.lessonId);
      resumeBackup={endedAt:old.endedAt,completionStatus:old.completionStatus,completedOnPlatform:old.completedOnPlatform};
      old.endedAt=null;
      s.currentId=old.id;s.signature=old.signature;s.qualityAuto=null;s.playback=null;s.endedObserved=null;
      old.completionStatus='A continuar a aula';
      startupLessonId=old.id;
    }else{
      const lesson=createLesson(s,normalizedMeta({url:tab.url,title:'Aula sem título',course:'Hotmart',confidence:'baixa'}),'captura desde o início');
      startupLessonId=lesson.id;
    }
    // O CDP de rede já está ativo, e a posição foi confirmada antes da criação
    // da captura. Falhar o seek nunca cria uma nova entrada sem o início.
    const lesson=currentLesson(s);
    if(lesson){lesson.resumeFromSeconds=decision.seconds;lesson.rewindVerifiedAt=now();}
    addLog(s,decision.kind==='resume'?
      `Captura retomada desde ${rewind.actual.toFixed(1)} s (sobreposição de 8 s, falas deduplicadas).`:
      `Captura iniciada após confirmar vídeo no início (${rewind.actual.toFixed(1)} s).`);
    updateBadge(s,tabId);

    chrome.tabs.sendMessage(tabId,{type:'SCAN'}).catch(()=>{});
    chrome.alarms.create(SPEED_ALARM,{when:Date.now()+2500}).catch(()=>{});
  }catch(e){
    if(startupLessonId){
      if(decision.kind==='resume' && resumeBackup){
        const old=findLesson(s,startupLessonId);
        if(old)Object.assign(old,resumeBackup);
      } else s.lessons=s.lessons.filter(l=>l.id!==startupLessonId || l.segments>0);
    }
    // Um erro depois de attach não pode deixar o Brave a depurar um separador
    // enquanto o painel afirma PARADO. Recuar, libertar a ligação e permitir retry.
    // Em caso de falha não fechar nem alterar uma captura anterior.
    s.tracking=false;s.tabId=null;s.currentId=null;s.routeUrl=null;s.routePending=null;
    s.playback=null;s.speedStatus=null;s.qualityStatus=null;s.qualityAuto=null;
    playerSessions.clear();mainWorldContexts.clear();
    if(attached){
      recoveryDetachDeadline.set(tabId,Date.now()+3000);
      try{await chrome.debugger.detach({tabId});}catch{recoveryDetachDeadline.delete(tabId);}
    }
    updateBadge(s,tabId);
    throw e;
  }
}
async function stop(s,reason='paragem manual',detached=false){
  if(!s.tracking)return;
  const tabId=s.tabId;
  // Não deixar o vídeo preso a 3×/4×/6× depois de clicar em Parar.
  // Se o debugger já tiver sido desligado pelo Brave, não tentar reanexar.
  if(!detached && s.qualityMinOnCapture){
    try{const inspection=await readPlayback(tabId);if(inspection.probe)await applyQualityToProbe(s,inspection.probe,'restore',true);}catch{}
  }
  if(!detached && s.playbackSpeed>1){
    try{
      const inspection=await readPlayback(tabId);
      if(inspection.probe){s.playbackSpeed=1;await applySpeedToProbe(s,inspection.probe,true);}
    }catch{} // A captura e as legendas têm prioridade ao sair.
  }
  finishCurrent(s,reason);
  s.tracking=false;s.tabId=null;s.signature=null;s.finishedSignature=null;s.routeUrl=null;s.routePending=null;s.sessionNotice=null;
  requests.clear();playerSessions.clear();mainWorldContexts.clear();s.playback=null;s.endedObserved=null;
  await chrome.alarms.clear(WATCHDOG_ALARM);await chrome.alarms.clear(FINISH_ALARM);await chrome.alarms.clear(SPEED_ALARM);
  // Parar captura desativa a política de aceleração nas aulas seguintes.
  s.playbackSpeed=6;s.speedStatus={requested:6,applied:null,status:'Captura parada; 6× será aplicado no próximo arranque',at:Date.now()};
  s.qualityStatus={status:'Captura parada',applied:false,at:Date.now()};s.qualityAuto=null;
  if(!detached){try{await chrome.debugger.detach({tabId});}catch(e){addLog(s,'Debugger já desligado: '+errMsg(e));}}
  updateBadge(s,tabId);
}
function requestKey(target,requestId){return `${target.tabId}:${target.sessionId||'main'}:${requestId}`;}
async function handleRequest(target,method,p){
  const tabId=target.tabId;
  if(method==='Network.requestWillBeSent'){
    // Vincular ao vídeo quando o pedido COMEÇA, não quando o corpo chega.
    // Um segmento do vídeo antigo pode terminar depois de mudar de aula.
    const url=p.request?.url||'';
    if(!isVttCandidate(url,''))return;
    const key=requestKey(target,p.requestId);
    // A cache só é usada para preservar uma identificação já confirmada.
    if(cache?.tracking && cache.tabId===tabId)
      requests.set(key,{url,lessonId:cache.currentId||null});
  } else if(method==='Network.responseReceived'){
    const response=p.response||{};
    if(!isVttCandidate(response.url,response.mimeType))return;
    const key=requestKey(target,p.requestId);
    const started=requests.get(key);
    requests.set(key,{url:response.url,lessonId:started?.lessonId||null});
    await serial(async s=>{
      if(!allowedTab(s,tabId)){requests.delete(key);return;}
      // A própria rede também vigia a URL. Mesmo que o evento SPA falhe,
      // o primeiro VTT da nova aula provoca o fecho da captura anterior.
      await syncTabRoute(s,tabId);
      if(currentLesson(s)?.title==='Aula sem título')await ensureLessonTitle(s);
      const entry=requests.get(key);
      if(entry && !entry.lessonId)entry.lessonId=s.currentId;
    });
  } else if(method==='Network.loadingFinished'){
    const key=requestKey(target,p.requestId);
    if(!requests.has(key))return; // ignora totalmente ficheiros que não são VTT
    // serial() evita competir com o evento anterior e com mudanças da aula.
    await serial(async s=>{
      const info=requests.get(key);requests.delete(key);if(!info)return;
      if(!allowedTab(s,tabId))return;
      try{const body=await chrome.debugger.sendCommand(target,'Network.getResponseBody',{requestId:p.requestId});await recordSegment(s,tabId,info,body);}
      catch(e){s.captureErrors++;addLog(s,'Falha a ler um segmento VTT: '+errMsg(e));}
    });
  } else if(method==='Network.loadingFailed')requests.delete(requestKey(target,p.requestId));
}
// Ler tempo/progresso de vídeos HTML5 na página e em iframes seguidos pelo debugger.
// Sem scripts em todos os sites e sem procurar URLs de legendas fora da aula atual.
async function readPlayback(tabId){
  const targets=[{tabId},...playerSessions.values()].filter(t=>t.tabId===tabId);
  const results=await Promise.all(targets.map(target=>
    probeDebuggerTarget((t,method,args)=>chrome.debugger.sendCommand(t,method,args),target,VIDEO_PROBE)));
  const available=results.flatMap(result=>result.probes).sort((a,b)=>b.score-a.score);
  return {probe:available[0]||null,contexts:results.reduce((total,r)=>total+r.scanned,0),targets:targets.length};
}
async function attemptNext(s,source){
  const tabId=s.tabId;
  try{
    const answer=await chrome.tabs.sendMessage(tabId,{type:'ADVANCE_NEXT'});
    if(answer?.ok){addLog(s,`Tentativa de avançar para a próxima aula (${source}, ${answer.mode}).`);return true;}
    addLog(s,'Avanço automático indisponível: '+(answer?.reason||'controlo não encontrado'));
  }catch(e){addLog(s,'Falha ao enviar comando de avanço: '+errMsg(e));}
  return false;
}
async function attemptResume(s,selectedProbe){
  // O contexto identificado pela sonda pode pertencer a um iframe do mesmo
  // renderer. Retomar apenas esse contexto, não vídeos de outras aulas.
  if(!selectedProbe?.cdpTarget)return false;
  const args={expression:`(() => {
    const videos=[];const seen=new Set();
    function find(root){if(!root||seen.has(root))return;seen.add(root);
      for(const v of root.querySelectorAll('video'))videos.push(v);
      for(const el of root.querySelectorAll('*')){
        if(el.shadowRoot)find(el.shadowRoot);
        if(el.tagName==='IFRAME'){try{find(el.contentDocument)}catch{}}
      }
    }
    find(document);
    const v=videos.find(x=>!x.paused&&!x.ended);
    if(!v)return 'não aplicável';
    v.pause();v.play().catch(()=>{});return 'tentativa de play';
  })()`,returnByValue:true,userGesture:true};
  if(Number.isSafeInteger(selectedProbe.cdpContextId))args.contextId=selectedProbe.cdpContextId;
  try{
    const result=await chrome.debugger.sendCommand(selectedProbe.cdpTarget,'Runtime.evaluate',args);
    if(result?.result?.value==='tentativa de play'){
      addLog(s,'Reprodução sem progresso: pedido de retoma enviado ao contexto do player.');
      return true;
    }
  }catch(e){addLog(s,'Retoma indisponível neste iframe: '+errMsg(e));}
  addLog(s,'Não foi possível retomar o vídeo automaticamente. Verifica o player.');return false;
}
// A velocidade só é alterada mediante seleção explícita no popup. O ajuste
// é reaplicado a cada nova aula e quando o player repõe a velocidade.
async function applySpeedToProbe(s,probe,force=false){
  const desired=checkedSpeed(s.playbackSpeed ?? 1);
  if(!probe?.cdpTarget)return {status:'Player ainda não acessível',applied:null};
  const previous=s.speedStatus||{};
  if(!force && desired===1)return previous;
  if(!force && matchesSpeed(probe.playbackRate,desired)){
    s.speedStatus={requested:desired,applied:probe.playbackRate,status:`Velocidade confirmada: ${speedLabel(probe.playbackRate)}`,at:Date.now(),lessonId:s.currentId,trackId:probe.trackId};
    return s.speedStatus;
  }
  if(!force && previous.lessonId===s.currentId && previous.trackId===probe.trackId && Date.now()-Number(previous.at||0)<20000)return previous;
  const args={expression:speedExpression(desired),returnByValue:true};
  if(Number.isSafeInteger(probe.cdpContextId))args.contextId=probe.cdpContextId;
  try{
    const response=await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',args);
    const result=response?.result?.value;
    const applied=Number.isFinite(result?.rate)?result.rate:null;
    let status;
    if(!result?.found)status='O vídeo mudou; a aguardar novo player';
    else if(result.error)status=`Player recusou a velocidade: ${result.error}`;
    else if(matchesSpeed(applied,desired))status=`Velocidade aplicada: ${speedLabel(applied)}`;
    else status=`Player limitou a velocidade a ${applied===null?'um valor não detetado':speedLabel(applied)}`;
    s.speedStatus={requested:desired,applied,status,at:Date.now(),lessonId:s.currentId,trackId:probe.trackId};
    return s.speedStatus;
  }catch(e){
    s.speedStatus={requested:desired,applied:null,status:'Não foi possível alterar a velocidade neste player',at:Date.now(),lessonId:s.currentId,trackId:probe.trackId};
    return s.speedStatus;
  }
}
// Redução opt-in/opt-out apenas através de controladores de qualidade reais.
// Não manipula resolução via throttling de rede, que atrasaria os segmentos VTT.
async function applyQualityToProbe(s,probe,mode='min',force=false,automatic=false){
  if(!probe?.cdpTarget)return {status:'Player não acessível; a qualidade mantém-se inalterada',applied:false};
  const old=s.qualityStatus||{};
  if(mode==='min' && !force && old.lessonId===s.currentId && old.trackId===probe.trackId &&
      (old.doNotRetry || Date.now()-Number(old.at||0)<30000))return old;
  // Ativar Runtime faz o CDP comunicar os contextos JS já existentes.
  // Para controlar hls.js/video.js/JW precisamos do mundo principal do frame.
  try{await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.enable',{});}catch{}
  const contexts=mainWorldContexts.get(contextKey(probe.cdpTarget));
  const mainContext=probe.cdpFrameId ? contexts?.get(probe.cdpFrameId) : null;
  const args={expression:qualityExpression(mode),returnByValue:true};
  if(Number.isSafeInteger(mainContext))args.contextId=mainContext;
  else if(Number.isSafeInteger(probe.cdpContextId))args.contextId=probe.cdpContextId;
  try{
    const response=await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',args);
    let value=response?.result?.value;
    // O Hotmart Player disponibiliza frequentemente resoluções apenas no menu.
    // Quando não há API JS, reproduzimos os cliques do próprio menu, no frame
    // do vídeo, sem tocar nas respostas WEBVTT nem no stream HLS.
    if((mode==='min' && (value?.unsupported || !value?.applied)) || (mode==='restore' && (!value?.restored || value?.status==='Qualidade não alterada pela extensão'))){
      try{
        if(mode==='min'){
          // CDP Input envia um clique real ao renderer. O anterior element.click()
          // podia deixar Auto selecionado apesar de abrir corretamente o menu.
          const targetArgs={...args,expression:qualityMenuExpression('target',!probe.cdpTarget.sessionId),awaitPromise:true,userGesture:true};
          const located=(await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',targetArgs))?.result?.value;
          if(located?.ready && Number.isFinite(located.x) && Number.isFinite(located.y)){
            const clickAt=async point=>{
              // O CDP só recebe coordenadas verificadas pelo frame do vídeo.
              const pointer={x:point.x,y:point.y,button:'left',clickCount:1};
              for(const [type,buttons] of [['mouseMoved',0],['mousePressed',1],['mouseReleased',0]])
                await chrome.debugger.sendCommand(probe.cdpTarget,'Input.dispatchMouseEvent',{...pointer,type,buttons});
            };
            const verifyArgs={...args,expression:qualityMenuExpression('verify'),awaitPromise:true,userGesture:true};
            const verifyNow=async()=>{
              await new Promise(resolve=>setTimeout(resolve,1100));
              return (await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',verifyArgs))?.result?.value;
            };
            // Hotmart (DOM real): o menu é composto por botões React
            // role=menuitem / aria-label=240p. Tentar esse botão explícito
            // PRIMEIRO; só usar coordenadas CDP se o estado não mudar.
            let verified=null;
            let clickPoint=located;
            try{
              const nativeArgs={...args,expression:hotmartNativeQualityExpression(located.height),awaitPromise:true,userGesture:true};
              const native=(await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',nativeArgs))?.result?.value;
              if(native?.attempted||native?.alreadySelected){
                verified=await verifyNow();
                addLog(s,'Qualidade Hotmart '+located.height+'p: botão específico '+
                  (native.attempted?'acionado':'já selecionado')+', confirmação '+(verified?.applied?'sim':'não'));
                if(!verified?.applied){
                  // A UI pode fechar o submenu. Não clicar às cegas no vídeo
                  // usando coordenadas antigas; voltar a localizar a opção.
                  const newLocated=(await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',targetArgs))?.result?.value;
                  clickPoint=newLocated?.ready&&newLocated.height===located.height?newLocated:null;
                }
              }
            }catch(e){addLog(s,'Qualidade: fallback Hotmart indisponível: '+errMsg(e));}
            if(!verified?.applied && clickPoint){
              await clickAt(clickPoint);
              verified=await verifyNow();
            // Em alguns menus o centro do elemento é apenas uma área de hover.
            // Recalcular o alvo no texto '240p' e tentar uma vez mais SOMENTE
            // quando o menu permanece aberto e a qualidade não foi confirmada.
            if(!automatic && verified?.found && !verified.applied && verified.menuOpenedForVerification){
              const retryArgs={...args,expression:qualityMenuExpression('retry-target',!probe.cdpTarget.sessionId),awaitPromise:true,userGesture:true};
              const retry=(await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',retryArgs))?.result?.value;
              if(retry?.ready && retry.height===located.height && Number.isFinite(retry.x)&&Number.isFinite(retry.y) &&
                 Math.hypot(retry.x-clickPoint.x,retry.y-clickPoint.y)>=8){
                await clickAt(retry);
                verified=await verifyNow();
                addLog(s,'Qualidade '+located.height+'p: segundo clique dirigido ao texto; confirmado: '+(verified?.applied?'sim':'não'));
              }
            }
            // Última alternativa: Enter APENAS se o controlo da resolução
            // tiver foco e o menu continuar a mostrar a mesma opção.
            if(!automatic && verified?.found && !verified.applied && verified.menuOpenedForVerification){
              const focusArgs={...args,expression:qualityMenuExpression('focus-target'),awaitPromise:true,userGesture:true};
              const focused=(await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',focusArgs))?.result?.value;
              if(focused?.ready){
                await chrome.debugger.sendCommand(probe.cdpTarget,'Input.dispatchKeyEvent',{
                  type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13
                });
                await chrome.debugger.sendCommand(probe.cdpTarget,'Input.dispatchKeyEvent',{
                  type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13
                });
                verified=await verifyNow();
                addLog(s,'Qualidade '+located.height+'p: Enter com foco na opção; confirmado: '+(verified?.applied?'sim':'não'));
              }
            }
            } // Fim das tentativas CDP, apenas se não houve confirmação nativa.
            value=verified?.found?verified:{...located,applied:false,status:'Seleção enviada, mas a confirmação do player está indisponível'};
            if(!value.applied)value={...value,status:'Qualidade '+located.height+'p NÃO confirmada. O player pode continuar em Auto; verifica o menu de qualidade.'};
            addLog(s,'Menu qualidade: tentativa '+located.height+'p, confirmação '+(value?.applied?'sim':'não'));
          }else if(located?.status){
            value={...located,doNotRetry:true};
          }
        }else{
          const menuArgs={...args,expression:qualityMenuExpression(mode),awaitPromise:true,userGesture:true};
          const menuResponse=await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',menuArgs);
          const menuValue=menuResponse?.result?.value;
          if(menuValue?.found && (menuValue.applied||menuValue.restored||menuValue.status))value=menuValue;
        }
      }catch(e){addLog(s,'Menu de qualidade indisponível: '+errMsg(e));}
    }
    if(automatic){
      // A verificação pode voltar a abrir Qualidade. Fechar uma vez no fim;
      // nunca deixar o supervisor reabrir a janela a cada atualização.
      try{
        const dismissArgs={...args,expression:qualityMenuExpression('dismiss'),awaitPromise:true,userGesture:true};
        const dismiss=(await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',dismissArgs))?.result?.value;
        if(dismiss?.open && !dismiss.closed){
          for(const type of ['keyDown','keyUp'])await chrome.debugger.sendCommand(probe.cdpTarget,'Input.dispatchKeyEvent',{
            type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27,nativeVirtualKeyCode:27
          });
        }
      }catch{}
    }
    const status=typeof value?.status==='string'?value.status:'Não foi possível verificar a qualidade deste player';
    const result={status,applied:Boolean(value?.applied),doNotRetry:Boolean(value?.doNotRetry),provider:value?.provider||null,
      height:Number.isFinite(value?.height)?value.height:null,observedHeight:Number.isFinite(value?.observedHeight)?value.observedHeight:null,
      contextType:Number.isSafeInteger(mainContext)?'principal':Number.isSafeInteger(probe.cdpContextId)?'isolado':'predefinido',at:Date.now(),lessonId:s.currentId,trackId:probe.trackId};
    s.qualityStatus=result;
    return result;
  }catch{
    s.qualityStatus={status:'Controlo de qualidade indisponível neste iframe; legendas continuam a ser capturadas',
      applied:false,at:Date.now(),lessonId:s.currentId,trackId:probe.trackId};
    return s.qualityStatus;
  }
}
async function setQualityPreference(s,enabled){
  s.qualityMinOnCapture=Boolean(enabled);
  if(!s.tracking){s.qualityStatus={status:s.qualityMinOnCapture?'Será aplicada ao iniciar a captura':'Desativada',applied:false};return s.qualityStatus;}
  const inspection=await readPlayback(s.tabId);
  if(inspection.probe){acknowledgeManualQuality(s);await applyQualityToProbe(s,inspection.probe,enabled?'min':'restore',true);}
  else s.qualityStatus={status:'Player ainda não acessível — a captura continua normalmente',applied:false,at:Date.now()};
  addLog(s,`Qualidade mínima ${enabled?'ativada':'desativada'}: ${s.qualityStatus.status}`);
  return s.qualityStatus;
}
async function setSpeed(s,value){
  if(!s.tracking)throw Error('Inicia primeiro a captura na aula Hotmart.');
  s.playbackSpeed=checkedSpeed(value);
  s.speedStatus={requested:s.playbackSpeed,applied:null,status:'A procurar o player para aplicar a velocidade',at:0,lessonId:s.currentId};
  const inspection=await readPlayback(s.tabId);
  if(inspection.probe){await applySpeedToProbe(s,inspection.probe,true);}
  else {s.speedStatus.status='Player indisponível; velocidade pendente, a captura de legendas continua';}
  addLog(s,`Velocidade pedida: ${speedLabel(s.playbackSpeed)}. ${s.speedStatus.status}`);
  return {speed:s.playbackSpeed,applied:s.speedStatus.applied,status:s.speedStatus.status};
}
async function installCompletionListener(s,probe){
  if(!probe?.cdpTarget || !s.currentId)return;
  const activeId=s.currentId, activeUrl=currentLesson(s)?.pageUrl||'';
  const args={expression:`(() => {
    const activeId=${JSON.stringify(activeId)},activeUrl=${JSON.stringify(activeUrl)};
    const marker='fhadVttCompletionBound_v077';
    let installed=0;const roots=new Set();
    function walk(root){if(!root||roots.has(root))return;roots.add(root);
      for(const el of root.querySelectorAll('video')){
        const existing=el[marker];
        if(existing?.activeId===activeId)continue;
        if(existing?.handler)el.removeEventListener('ended',existing.handler);
        const handler=()=>console.info('FHAD_VTT_VIDEO_END:'+JSON.stringify({lessonId:activeId,url:activeUrl}));
        el[marker]={activeId,handler};installed++;
        el.addEventListener('ended',handler);
      }
      for(const el of root.querySelectorAll('*'))if(el.shadowRoot)walk(el.shadowRoot);
    }
    walk(document);return installed;
  })()`,returnByValue:true};
  if(Number.isSafeInteger(probe.cdpContextId))args.contextId=probe.cdpContextId;
  try{await chrome.debugger.sendCommand(probe.cdpTarget,'Runtime.evaluate',args);}catch{}
}
async function runWatchdog(s,source='verificação periódica'){
  if(!s.tracking || !s.currentId)return;
  await ensureLessonTitle(s);
  const inspection=await readPlayback(s.tabId);
  const probe=inspection.probe;
  if(!probe){
    if(s.playbackSpeed>1)s.speedStatus={requested:s.playbackSpeed,applied:null,status:'Player não acessível — velocidade pendente',at:Date.now(),lessonId:s.currentId};
    if(s.qualityMinOnCapture && !s.qualityAuto?.attempted)s.qualityStatus={status:'Player não acessível — não foi possível reduzir a qualidade',applied:false,at:Date.now(),lessonId:s.currentId};
    // Não transportar um relógio de progresso antigo para quando o player voltar.
    s.playback={lessonId:s.currentId,status:'tempo do player indisponível — captura VTT continua ativa',
      contextsInspected:inspection.contexts,targetsInspected:inspection.targets,lastProbeAt:Date.now()};
    if(source==='fim detetado')await markLessonViewed(s,null);
    if(source==='fim detetado' && s.autoRecover && s.endedObserved?.lessonId===s.currentId && Date.now()-s.endedObserved.at>=12000 && !s.endedObserved.attempted){
      s.endedObserved.attempted=true;await attemptNext(s,'evento de fim HTML5');
    }
    return;
  }
  await installCompletionListener(s,probe);
  if(s.playbackSpeed>1)await applySpeedToProbe(s,probe,source==='novo player');
  if(s.qualityMinOnCapture){
    const choice=autoQualityDecision(s,probe);
    if(choice.action==='schedule'){
      // O mesmo alarme usado na inicialização funciona mesmo com o popup fechado.
      try{await chrome.alarms.create(SPEED_ALARM,{when:Date.now()+Math.max(500,Math.ceil(choice.after))});}catch{}
      s.qualityStatus={...s.qualityStatus,status:'A aguardar reprodução estável antes de aplicar qualidade mínima',lessonId:s.currentId};
    }else if(choice.action==='attempt'){
      const outcome=await applyQualityToProbe(s,probe,'min',true,true);
      if(!outcome.applied){
        outcome.doNotRetry=true;
        outcome.status+=' · Tentativa automática terminada. Usa «Verificar qualidade agora» para repetir manualmente.';
      }
    }
  }
  // O utilizador pode também repor 1×; nesse caso a alteração é aplicada no clique.
  const previous=s.playback||{};
  // O ID da aula impede que dados de recuperação de uma aula afetem a seguinte.
  const input=previous.lessonId===s.currentId?previous:{};
  const choice=playbackDecision(input,probe,Date.now());
  s.playback={...choice.state,lessonId:s.currentId};
  if(probe.ended || (probe.paused && probe.duration>0 && probe.currentTime>=probe.duration-0.8))
    await markLessonViewed(s,probe);
  if(!probe.ended && probe.currentTime<(probe.duration||Infinity)-1)s.endedObserved=null;
  if(!s.autoRecover || !choice.action)return;
  if(choice.action==='next'){
    const ok=await attemptNext(s,source);
    if(!ok)s.playback.status='Fim do vídeo; avança manualmente ou verifica a Hotmart';
  }else if(choice.action==='resume')await attemptResume(s,probe);
}
chrome.debugger.onEvent.addListener((target,method,params)=>{
  if(typeof target.tabId!=='number')return;
  if(method==='Runtime.consoleAPICalled'){
    const arg=params.args?.find(a=>typeof a.value==='string'&&a.value.startsWith(END_MESSAGE));
    if(arg){
      let event=null;try{event=JSON.parse(arg.value.slice(END_MESSAGE.length));}catch{return;}
      serial(async s=>{
        if(!allowedTab(s,target.tabId))return;
        const lesson=currentLesson(s);
        if(!lesson || lesson.id!==event?.lessonId || lesson.pageUrl!==cleanUrl(event?.url))return;
        const at=Date.now();s.endedObserved={lessonId:lesson.id,at,attempted:false};
        await markLessonViewed(s,null);
        await chrome.alarms.create(FINISH_ALARM,{when:at+13000});
      }).catch(()=>{});
    }
    return;
  }
  if(method==='Runtime.executionContextCreated'){trackContext(target,params.context);return;}
  if(method==='Runtime.executionContextsCleared'){mainWorldContexts.delete(contextKey(target));return;}
  if(method==='Runtime.executionContextDestroyed'){
    const entries=mainWorldContexts.get(contextKey(target));
    if(entries)for(const [frame,id] of entries)if(id===params.executionContextId)entries.delete(frame);
    return;
  }
  if(method==='Target.attachedToTarget'){
    const child={...target,sessionId:params.sessionId};
    playerSessions.set(params.sessionId,child);
    (async()=>{
      await chrome.debugger.sendCommand(child,'Network.enable',{maxTotalBufferSize:100000000,maxResourceBufferSize:10000000});
      await chrome.debugger.sendCommand(child,'Page.enable',{}).catch(()=>{});
      await chrome.debugger.sendCommand(child,'Runtime.enable',{}).catch(()=>{});
      await chrome.debugger.sendCommand(child,'Target.setAutoAttach',{
        autoAttach:true,waitForDebuggerOnStart:false,flatten:true,
        filter:[{type:'iframe',exclude:false}]
      });
    })().catch(e=>console.warn('Não foi possível acompanhar iframe:',e));
  }
  if(method==='Target.detachedFromTarget' && params.sessionId){
    playerSessions.delete(params.sessionId);
    mainWorldContexts.delete(contextKey({...target,sessionId:params.sessionId}));
  }
  if(method==='Network.requestWillBeSent'||method==='Network.responseReceived'||method==='Network.loadingFinished'||method==='Network.loadingFailed')
    handleRequest(target,method,params).catch(e=>console.warn('Evento:',e));
});
chrome.alarms.onAlarm.addListener(alarm=>{
  if(alarm.name!==WATCHDOG_ALARM && alarm.name!==FINISH_ALARM && alarm.name!==SPEED_ALARM)return;
  serial(s=>runWatchdog(s,alarm.name===FINISH_ALARM?'fim detetado':'supervisão')).catch(()=>{});
});
chrome.debugger.onDetach.addListener((target,reason)=>{
  if(typeof target.tabId!=='number')return;
  const deadline=recoveryDetachDeadline.get(target.tabId);
  if(deadline){recoveryDetachDeadline.delete(target.tabId);if(Date.now()<=deadline)return;}
  serial(async s=>{if(allowedTab(s,target.tabId)){
    addLog(s,'A depuração foi desligada: '+reason);
    await stop(s,'depuração desligada',true);
    s.lastError='O Brave desligou a captura. Se abriste o DevTools, fecha-o e inicia novamente.';
  }}).catch(()=>{});
});
chrome.tabs.onRemoved.addListener(tabId=>{
  serial(async s=>{if(allowedTab(s,tabId))await stop(s,'separador fechado',true);}).catch(()=>{});
});
chrome.webNavigation.onCommitted.addListener(d=>{
  if(d.frameId!==0)return;
  serial(async s=>{
    if(!allowedTab(s,d.tabId))return;
    if(!isHotmartPage(d.url)){await stop(s,'saída da Hotmart');return;}
    onRouteChanged(s,d.tabId,d.url,'navegação normal');
  }).catch(()=>{});
});
// Hotmart usa SPA/history.pushState: onCommitted não é emitido para essas trocas.
// Esta é a proteção primária contra legendas associadas ao módulo anterior.
chrome.webNavigation.onHistoryStateUpdated.addListener(d=>{
  if(d.frameId!==0)return;
  serial(s=>onRouteChanged(s,d.tabId,d.url,'navegação SPA')).catch(()=>{});
});
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.clear(WATCHDOG_ALARM);chrome.alarms.clear(FINISH_ALARM);chrome.alarms.clear(SPEED_ALARM);serial(async s=>{
  const oldTab=s.tabId;
  if(s.currentId)markEnded(s,'Brave reiniciado');
  s.tracking=false;s.tabId=null;s.currentId=null;s.routeUrl=null;s.routePending=null;s.playbackSpeed=6;s.speedStatus=null;s.qualityStatus=null;
  updateBadge(s,oldTab);await clearInactiveBadges(s);
  addLog(s,'Brave reiniciado: transcrições anteriores mantidas.');
}).catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.clear(WATCHDOG_ALARM);chrome.alarms.clear(FINISH_ALARM);chrome.alarms.clear(SPEED_ALARM);serial(async s=>{
  const tabId=s.tabId;
  if(s.currentId)markEnded(s,'extensão atualizada');
  s.tracking=false;s.tabId=null;s.currentId=null;s.signature=null;s.finishedSignature=null;s.routeUrl=null;s.routePending=null;s.playbackSpeed=6;s.qualityMinOnCapture=true;s.speedStatus=null;s.qualityStatus=null;
  for(const l of s.lessons){
    // Eliminar agendamentos de download herdados da versão 0.2.0.
    delete l.pendingExportAt;
    if(l.exportStatus==='a aguardar segmentos finais')l.exportStatus='';
  }
  addLog(s,'Extensão atualizada. Transcrições anteriores preservadas; downloads apenas manuais.');
  updateBadge(s,tabId);await clearInactiveBadges(s);
}).catch(()=>{});});
chrome.downloads.onChanged.addListener(delta=>{
  if(!delta.state)return;
  serial(s=>{for(const lesson of s.lessons){if(lesson.downloadId!==delta.id)continue;
    if(delta.state.current==='complete')lesson.exportStatus='concluído';
    if(delta.state.current==='interrupted'){lesson.exportStatus='erro';lesson.exportedSegments=0;
      delete lesson.exportedTitle;delete lesson.exportedCourse;delete lesson.exportedCues;}
  }}).catch(()=>{});
});
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  serial(async s=>{
    switch(msg?.type){
      case 'PREPARE_START':return await prepareCaptureStart(s,msg.tabId);
      case 'START':{
        try{await start(s,msg.tabId,msg.mode,msg.resumeLessonId);return {tracking:true};}
        catch(e){
          s.lastError='Falha ao iniciar captura: '+errMsg(e);
          addLog(s,s.lastError);
          return {ok:false,error:s.lastError,tracking:false};
        }
      }
      case 'STOP':await stop(s);return {tracking:false};
      case 'STATE':{
        // Identificar o separador antes de ler o estado permite recuperar uma
        // captura CDP mesmo se getTargets() não anunciar a aba como attached.
        // O popup informa tabId explicitamente; não anexamos um debugger novo.
        if(!s.tracking){
          const recovered=await reconcileCaptureSession(s,msg.tabId);
          if(recovered)await saveState(s);
        }
        let connected=false;
        if(s.tracking){
          connected=await ownsDebuggerSession(s.tabId);
          // Se a verificação falhar numa navegação, não descartar legendas:
          // onDetach é responsável por encerrar uma sessão realmente desligada.
          if(connected){
            const resolved=await ensureLessonTitle(s);
            if(resolved)await saveState(s);
          }
          updateBadge(s);
        }else await clearInactiveBadges(s);
        return {state:{...s,sessionHealth:{connected,checkedAt:now()},
          lessons:s.lessons.map(({cues,...rest})=>({...rest,cueCount:(cues||[]).length}))}};
      }
      case 'METADATA':await onMetadata(s,sender.tab?.id,msg.meta);return {ok:true};
      case 'PLAYER_ENDED':{
        if(allowedTab(s,sender.tab?.id) && cleanUrl(msg.pageUrl)===currentLesson(s)?.pageUrl){
          const at=Date.now();s.endedObserved={lessonId:s.currentId,at,attempted:false};
          if(s.playback?.lessonId===s.currentId)s.playback.endedSince=at;
          await markLessonViewed(s,null);
          await chrome.alarms.create(FINISH_ALARM,{when:at+13000});
        }
        return {ok:true};}
      case 'SPEED_SET':return await setSpeed(s,msg.speed);
      case 'QUALITY_SET':return await setQualityPreference(s,msg.enabled);
      case 'QUALITY_CHECK':{
        if(!s.tracking){s.qualityStatus={status:'Captura parada: a extensão não controla a qualidade do vídeo.',applied:false};return s.qualityStatus;}
        const inspection=await readPlayback(s.tabId);
        if(inspection.probe){acknowledgeManualQuality(s);return await applyQualityToProbe(s,inspection.probe,s.qualityMinOnCapture?'min':'restore',true);}
        s.qualityStatus={status:'Player não acessível para consultar resolução. Usa as definições do vídeo.',applied:false};
        return s.qualityStatus;
      }
      case 'RECOVER_SETTINGS':s.autoRecover=Boolean(msg.enabled);addLog(s,`Recuperação automática ${s.autoRecover?'ativada':'desativada'}.`);return {ok:true};
      case 'PLAYER_ACTIVITY': {
        if(!allowedTab(s,sender.tab?.id))return {ok:true};
        // Uma mensagem de um iframe não pode aplicar a qualidade à URL da aula
        // anterior enquanto o SPA da Hotmart está a transitar.
        await syncTabRoute(s,sender.tab.id);
        // timeupdate periódico serve apenas para acordar uma captura pendente
        // iniciada a meio do vídeo. Depois de aplicada a qualidade e a
        // velocidade, ignorar o evento para poupar CDP/storage.
        if(msg.reason==='timeupdate' && s.qualityAuto?.attempted &&
            (s.playbackSpeed<=1 || s.speedStatus?.applied===s.playbackSpeed))return {ok:true};
        // runWatchdog já protege a qualidade através de qualityAuto.attempted;
        // não impedir a reaplicação de 6x quando o provider substitui o <video>
        // sem mudar de URL/lessonId.
        if(s.playbackSpeed>1 || s.qualityMinOnCapture)await runWatchdog(s,'novo player');
        return {ok:true};
      }
      case 'CHECK_PLAYER':if(s.tracking)await runWatchdog(s,'verificação manual');return {ok:true};
      case 'NEXT_LESSON':{if(!s.tracking)throw Error('A captura tem de estar ativa.');const ok=await attemptNext(s,'pedido manual');if(!ok)throw Error('Não foi possível identificar o botão Próxima aula. Usa o botão da Hotmart.');return {advanced:true};}
      case 'RENAME':{
        const l=findLesson(s,msg.lessonId);if(!l)throw Error('Aula não encontrada.');
        const title=String(msg.title||'').trim().slice(0,160);
        if(!title)throw Error('O título não pode estar vazio.');
        l.title=title;l.confidence='alta';l.warnings=l.warnings.filter(x=>!x.includes('Identificação automática'));
        if(s.currentId===l.id && s.routePending?.url===l.pageUrl)s.routePending=null;
        // O ZIP existente pode ter o nome anterior; permitir nova exportação manual.
        l.exportStatus='';l.exportedSegments=0;
        delete l.exportedTitle;delete l.exportedCourse;delete l.exportedCues;
        updateBadge(s);addLog(s,`Título confirmado manualmente: ${title}`);return {ok:true};}
      case 'SPLIT':{
        if(!s.tracking)throw Error('Inicia a captura primeiro.');
        const old=currentLesson(s);const meta=normalizedMeta({url:old?.pageUrl || msg.url,title:msg.title || 'Nova aula',course:old?.course||'Hotmart',confidence:'média'});
        finishCurrent(s,'nova aula manual');s.routePending=null;createLesson(s,meta,'divisão manual');return {ok:true};}
      case 'MERGE':return mergeLessons(s,msg.lessonIds);
      case 'UNDO_MERGE':return undoMerge(s,msg.lessonId);
      case 'CLEAR_MERGED_SOURCES':return clearMergedSources(s,msg.lessonIds);
      case 'EXPORT':{
        const lesson=findLesson(s,msg.lessonId);if(!lesson)throw Error('Aula não encontrada.');
        return await downloadLesson(s,lesson);}
      case 'EXPORT_SELECTED':return await downloadSelectedLessons(s,msg.lessonIds);
      case 'EXPORT_ALL':return await downloadAllLessons(s);
      case 'CLEAR_EXPORTED':return clearExportedLessons(s,msg.lessonIds);
      case 'CLEAR_EMPTY':return clearEmptyLessons(s,msg.lessonIds);
      case 'CLEAR_ELIGIBLE':return clearEligible(s);
      default:throw Error('Comando inválido.');
    }
  },!['STATE','PREPARE_START'].includes(msg?.type)).then(data=>reply({ok:true,...(data||{})})).catch(e=>reply({ok:false,error:errMsg(e)}));
  return true;
});
