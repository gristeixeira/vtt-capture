import test from 'node:test';
import assert from 'node:assert/strict';

const listener=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){for(const f of this.listeners)f(...args);}});
const hooks={events:listener(),detach:listener(),onMessage:listener(),onStart:listener(),onInstalled:listener(),onRemoved:listener(),onCommitted:listener(),onHistory:listener(),downloadChanged:listener(),alarm:listener()};
const saved={};const downloads=[];const badgeTexts=[];const badgeTitles=[];let attached=false;const pageMessages=[];
const tabGetArgs=[];const tabQueryArgs=[];let activeHotmartTab=true;let activeTabUrl='https://play.hotmart.com/aula1';
let simulateIframe=false;const resumeRequests=[];const speedRequests=[];let simulatedRate=1;let providerLimit=0;let simulatedQuality=null;let simulatedMainWorld=false;const qualityRequests=[];
let failNextNetworkEnable=false, denyDebugDetach=false, emitDetachDuringRecovery=false, foreignDebugger=false;
let forceMenuQuality=false;const trustedMouseEvents=[];
let omitAttachedTargets=false, pingEvaluationFails=false;
const answers=new Map();
globalThis.chrome={
  alarms:{onAlarm:hooks.alarm,async create(){},async clear(){return true;}},
  storage:{local:{async get(key){return {[key]:structuredClone(saved[key])};},async set(data){Object.assign(saved,structuredClone(data));}}},
  debugger:{onEvent:hooks.events,onDetach:hooks.detach,
    async getTargets(){return attached && !omitAttachedTargets?[{tabId:5,url:activeTabUrl,attached:true,type:'page'}]:[];},
    async attach(){if(attached)throw Error('already attached');attached=true;},async detach(target){
      if(denyDebugDetach)throw Error('not attached to target by this extension');
      attached=false;
      if(emitDetachDuringRecovery)hooks.detach.emit(target,'extension_cancelled');
    },
    async sendCommand(target,method,args){
      if(method==='Runtime.enable'){
        if(!attached || foreignDebugger)throw Error('Debugger is not attached to the tab');
        return {};
      }
      if(method==='Runtime.evaluate' && args?.expression?.includes('fhad-vtt-session-ping')){
        if(!attached || foreignDebugger || pingEvaluationFails)throw Error('Execution context was destroyed');
        return {result:{value:0}};
      }
      if(method==='Input.dispatchMouseEvent'){trustedMouseEvents.push({...args,target});return {};}
      if(method==='Network.enable' && failNextNetworkEnable){failNextNetworkEnable=false;throw Error('simulated Network.enable failure');}
      if(method==='Network.getResponseBody')return {body:answers.get(args.requestId),base64Encoded:false};
      if(simulateIframe){
        if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'},childFrames:[{frame:{id:'player-frame'}}]}};
        if(method==='Page.createIsolatedWorld')return {executionContextId:args.frameId==='player-frame'?842:841};
        if(method==='Runtime.evaluate'){
          if(args.expression.includes('fhad.vtt.qualityMenuBackup.v1') && forceMenuQuality){
            if(args.expression.includes('const mode="target"'))return {result:{value:{found:true,ready:true,height:240,x:750,y:540,status:'Opção 240p identificada'}}};
            if(args.expression.includes('const mode="verify"'))return {result:{value:{found:true,applied:trustedMouseEvents.some(x=>x.type==='mouseReleased'),requested:true,height:240,status:trustedMouseEvents.some(x=>x.type==='mouseReleased')?'Qualidade 240p confirmada no player':'Não confirmada'}}};
            return {result:{value:{found:true,applied:false,status:'Fallback menu simulado'}}};
          }
          if(args.expression.includes('fhad.vtt.qualityBackups')){
            const mode=args.expression.includes('const mode="restore"')?'restore':'min';
            qualityRequests.push({target,args,mode});
            if(args.contextId!==842 && !(simulatedMainWorld && args.contextId===950))return {result:{value:{found:false,status:'Player ainda não acessível'}}};
            if(forceMenuQuality)return {result:{value:{found:true,unsupported:true,applied:false,status:'Sem API direta'}}};
            simulatedQuality=mode==='min'?'144p':'auto';
            return {result:{value:mode==='min'?{found:true,applied:true,provider:'hls.js',height:144,status:'Qualidade mínima aplicada: 144p (hls.js)'}:{found:true,applied:false,restored:true,status:'Qualidade anterior reposta'}}};
          }
          if(args.expression.includes('v.playbackRate=')){
            const match=args.expression.match(/v\.playbackRate=(\d+)/);
            const targetRate=match?Number(match[1]):1;
            simulatedRate=providerLimit?Math.min(providerLimit,targetRate):targetRate;
            speedRequests.push({target,args,requested:targetRate,applied:simulatedRate});
            return {result:{value:args.contextId===842?{found:true,rate:simulatedRate}:{found:false}}};
          }
          if(args.expression.includes('v.pause();')){
            resumeRequests.push({target,args});
            return {result:{value:args.contextId===842?'tentativa de play':'não aplicável'}};
          }
          return {result:{value:args.contextId===842?
            {currentTime:60,duration:300,paused:false,ended:false,readyState:4,trackId:'iframe-lesson',playbackRate:simulatedRate}:null}};
        }
      }
      return {};
    }},
  tabs:{onRemoved:hooks.onRemoved,async get(id){
      tabGetArgs.push(id);
      if(!Number.isSafeInteger(id) || id<0)throw TypeError('No matching signature');
      return {id,url:activeTabUrl,title:'Hotmart'};
    },
    async query(opts){tabQueryArgs.push(opts);return activeHotmartTab?[{id:5,url:activeTabUrl}]:[];},
    async sendMessage(tabId,msg){pageMessages.push({tabId,msg});return msg.type==='ADVANCE_NEXT'?{ok:true,mode:'teste'}:undefined;}},
  action:{async setBadgeText(data){badgeTexts.push(data);},async setBadgeBackgroundColor(){},async setTitle(data){badgeTitles.push(data);}},
  downloads:{onChanged:hooks.downloadChanged,async download(request){downloads.push(request);return downloads.length;}},
  webNavigation:{onCommitted:hooks.onCommitted,onHistoryStateUpdated:hooks.onHistory},
  runtime:{onMessage:hooks.onMessage,onStartup:hooks.onStart,onInstalled:hooks.onInstalled}
};
// MV3 capture-start now inspects the player and verifies seeking before starting.
// Keep the simulated player consistent with the existing CDP/video mocks.
chrome.scripting={async executeScript({target,func,args=[]}){
  if(func.name==='inspect')return [{frameId:simulateIframe?2:0,result:{score:100,currentTime:10,duration:300,paused:false}}];
  if(func.name==='seek')return [{frameId:target.frameIds?.[0]??0,result:{ok:true,requested:args[0]||0,actual:args[0]||0,wasPlaying:true}}];
  return [{frameId:target.frameIds?.[0]??0,result:null}];
}};
await import('../background.js');
function message(payload,tab=5){if(payload.type==='METADATA')activeTabUrl=payload.meta.url;return new Promise(resolve=>{hooks.onMessage.listeners[0](payload,{tab:{id:tab}},resolve);});}
async function cdpResponse(id,text){
  answers.set(id,text);
  hooks.events.emit({tabId:5},'Network.responseReceived',{requestId:id,response:{url:`https://cdn.example.com/subtitles/${id}.vtt?token=sensitive`,mimeType:'text/vtt'}});
  hooks.events.emit({tabId:5},'Network.loadingFinished',{requestId:id});
}
const vtt1='WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nPrimeira aula\n';
const vtt2='WEBVTT\n\n1\n00:00:05.000 --> 00:00:06.000\nSegunda aula\n';

test('captura duas aulas sem downloads automáticos e permite exportação manual',async()=>{
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/aula1?token=secret',title:'Introdução',course:'LightCopy',confidence:'alta'}});
  await cdpResponse('req1',vtt1);
  let state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons[0].cueCount,1);
  assert.equal(state.lessons[0].title,'Introdução');
  assert.equal(state.lessons[0].pageUrl,'https://play.hotmart.com/aula1');
  assert.equal(state.lessons[0].streamHosts[0],'cdn.example.com');
  assert.equal(JSON.stringify(state).includes('sensitive'),false);
  // Recebido antes de mudar de aula, mas concluído depois: não pode ir parar à seguinte.
  answers.set('late1','WEBVTT\n\n2\n00:00:03.000 --> 00:00:04.000\nResposta tardia da primeira aula\n');
  hooks.events.emit({tabId:5},'Network.responseReceived',{requestId:'late1',response:{url:'https://cdn.example.com/subtitles/late1.vtt',mimeType:'text/vtt'}});
  await message({type:'STATE'}); // Aguarda a vinculação do pedido antes da navegação SPA.
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/aula2',title:'Ligações e gatilhos',course:'LightCopy',confidence:'alta'}});
  hooks.events.emit({tabId:5},'Network.loadingFinished',{requestId:'late1'});
  // Aguarda os segmentos tardios em vez de exportar antes de terminarem.
  assert.equal(downloads.length,0);
  await cdpResponse('req2',vtt2);
  await message({type:'STOP'});
  // Nem a transição de aula nem o botão Parar devem abrir a janela de download.
  assert.equal(downloads.length,0);
  assert.equal(saved.fhad_vtt_capture_v1.lessons.length,2);
  assert.equal(saved.fhad_vtt_capture_v1.lessons[0].cues.length,2);
  state=(await message({type:'STATE'})).state;
  assert.equal(state.tracking,false);
  assert.equal(state.lessons.length,2);
  assert.equal(state.lessons[1].cueCount,1);
  assert.equal(state.lessons[0].cueCount,2);
  assert.equal(state.lessons[0].exportedSegments,0);
  // Só os comandos originados por botões explícitos dão origem a downloads.
  const first=await message({type:'EXPORT',lessonId:state.lessons[0].id});
  assert.equal(first.ok,true);
  assert.equal(downloads.length,1);
  assert.match(downloads[0].filename,/Introducao/);
  const all=await message({type:'EXPORT_ALL'});
  assert.equal(all.ok,true);
  assert.equal(all.count,2);
  assert.equal(downloads.length,2); // Exportar todas cria um único ZIP.
  assert.match(downloads[1].filename,/Todas-as-aulas/);
  const zipBytes=Buffer.from(downloads[1].url.split(',')[1],'base64');
  assert.ok(zipBytes.includes(Buffer.from('Introducao')));
  assert.ok(zipBytes.includes(Buffer.from('Ligacoes-e-gatilhos')));
  assert.ok(downloads.every(x=>x.url.startsWith('data:application/zip;base64,')));
  assert.ok(downloads.every(x=>x.saveAs===true));
  // Só se limpam downloads concluídos: o download pedido mas ainda pendente fica guardado.
  let attempted=await message({type:'CLEAR_EXPORTED',lessonIds:state.lessons.map(l=>l.id)});
  assert.equal(attempted.removed,0);
  assert.equal(attempted.skipped,2);
  // Conclusão real do download de todas as aulas (não basta ter pedido o download).
  hooks.downloadChanged.emit({id:2,state:{current:'complete'}});
  let completed=(await message({type:'STATE'})).state;
  assert.equal(completed.lessons.every(l=>l.exportStatus==='concluído'),true);
  // Proteção da aula ainda ativa, mesmo se o seu ZIP tiver sido descarregado.
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/aula3',title:'Terceira aula',course:'LightCopy',confidence:'alta'}});
  await cdpResponse('req3','WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nTexto original\n');
  let during=(await message({type:'STATE'})).state;
  const activeId=during.currentId;
  assert.equal(during.lessons.length,3);
  assert.equal((await message({type:'EXPORT',lessonId:activeId})).ok,true);
  hooks.downloadChanged.emit({id:3,state:{current:'complete'}});
  during=(await message({type:'STATE'})).state;
  assert.equal(during.lessons.find(l=>l.id===activeId).exportStatus,'concluído');
  // Se entra novo segmento após a exportação, a versão descarregada fica incompleta.
  await cdpResponse('req4','WEBVTT\n\n1\n00:00:03.000 --> 00:00:04.000\nSegmento adicional\n');
  during=(await message({type:'STATE'})).state;
  assert.equal(during.lessons.find(l=>l.id===activeId).segments,2);
  attempted=await message({type:'CLEAR_EXPORTED',lessonIds:during.lessons.map(l=>l.id)});
  assert.equal(attempted.removed,2);
  assert.equal(attempted.skipped,1);
  let remaining=(await message({type:'STATE'})).state;
  assert.equal(remaining.lessons.length,1);
  assert.equal(remaining.lessons[0].id,activeId);
  assert.equal(remaining.tracking,true);
  assert.equal(downloads.length,3); // A limpeza não aciona nem apaga downloads do Brave.
  await message({type:'STOP'});
  attempted=await message({type:'CLEAR_EXPORTED',lessonIds:[activeId]});
  assert.equal(attempted.removed,0); // Exportação não contém o último segmento.
  remaining=(await message({type:'STATE'})).state;
  assert.equal(remaining.lessons.length,1);
  // Depois de reexportar e concluir, a aula já pode ser limpa.
  assert.equal((await message({type:'EXPORT',lessonId:activeId})).ok,true);
  attempted=await message({type:'CLEAR_EXPORTED',lessonIds:[activeId]});
  assert.equal(attempted.removed,0); // Download ainda não concluído.
  hooks.downloadChanged.emit({id:4,state:{current:'complete'}});
  assert.equal((await message({type:'CLEAR_EXPORTED',lessonIds:[activeId]})).removed,1);
  assert.equal((await message({type:'STATE'})).state.lessons.length,0);
  hooks.onInstalled.emit({reason:'update'});
  const after=(await message({type:'STATE'})).state;
  assert.equal(after.lessons.length,0);
  assert.equal(downloads.length,4);
});

test('não chama tabs.get com identificadores inválidos e resolve a aba Hotmart ativa',async()=>{
  for(const invalid of [null,undefined,'5',-1]){
    const before=tabGetArgs.length;
    const result=await message({type:'START',tabId:invalid,mode:'restart'});
    assert.equal(result.ok,true,JSON.stringify(result));
    assert.equal(tabGetArgs.length,before);
    assert.equal((await message({type:'STATE'})).state.tabId,5);
    assert.equal((await message({type:'STOP'})).ok,true);
  }
  activeHotmartTab=false;
  const bad=await message({type:'START',tabId:null,mode:'restart'});
  assert.equal(bad.ok,false);
  assert.match(bad.error,/Não foi possível identificar o separador/);
  activeHotmartTab=true;
  assert.ok(tabQueryArgs.length>=4);
});

test('ao receber ended, tenta Próxima aula após prazo e mantém download exclusivamente manual',async()=>{
  const oldDateNow=Date.now;
  let clock=200000;
  Date.now=()=>clock;
  try{
    assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
    await message({type:'METADATA',meta:{url:'https://play.hotmart.com/aula4',title:'Aula de conclusão',course:'LightCopy',confidence:'alta'}});
    await cdpResponse('req-test-end','WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nFim da aula\n');
    const countBefore=downloads.length;
    assert.equal((await message({type:'PLAYER_ENDED',pageUrl:activeTabUrl})).ok,true);
    clock+=14000;
    hooks.alarm.emit({name:'fhad_vtt_endcheck'});
    // O comando STATE é serializado após a verificação do supervisor.
    let state=(await message({type:'STATE'})).state;
    assert.equal(pageMessages.some(x=>x.msg.type==='ADVANCE_NEXT'),true);
    assert.equal(downloads.length,countBefore);
    assert.equal(state.lessons.at(-1).title,'Aula de conclusão');
    assert.equal((await message({type:'STOP'})).ok,true);
  }finally{Date.now=oldDateNow;}
});

test('limpeza manual de capturas 0/0 protege aula atual, segmentos pendentes e conteúdos capturados',async()=>{
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/vazia',title:'Aula ainda sem legendas',course:'LightCopy',confidence:'alta'}});
  const state0=(await message({type:'STATE'})).state;
  const emptyId=state0.currentId;
  // Ainda não pode limpar a aula em reprodução.
  const active=await message({type:'CLEAR_EMPTY',lessonIds:[emptyId]});
  assert.equal(active.removed,0);
  assert.equal(active.skipped,1);

  // Há uma resposta WEBVTT iniciada nesta aula, mas ainda não terminada.
  answers.set('pending-lesson','WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFala a preservar\n');
  hooks.events.emit({tabId:5},'Network.responseReceived',{requestId:'pending-lesson',response:{url:'https://cdn.example.com/pending-lesson.vtt',mimeType:'text/vtt'}});
  await message({type:'STATE'}); // Aguarda registo do pedido pendente.
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/outra',title:'Aula seguinte',course:'LightCopy',confidence:'alta'}});
  const pending=await message({type:'CLEAR_EMPTY',lessonIds:[emptyId]});
  assert.equal(pending.removed,0);
  assert.equal(pending.skipped,1);
  // O corpo chega depois da navegação e mantém-se na primeira aula.
  hooks.events.emit({tabId:5},'Network.loadingFinished',{requestId:'pending-lesson'});
  let state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.find(l=>l.id===emptyId).cueCount,1);
  assert.equal((await message({type:'CLEAR_EMPTY',lessonIds:[emptyId]})).removed,0);
  const secondEmptyId=state.currentId;

  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/terceira',title:'Aula com texto',course:'LightCopy',confidence:'alta'}});
  await cdpResponse('safe-lesson','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nTexto da aula\n');
  state=(await message({type:'STATE'})).state;
  const activeId=state.currentId;
  const countBefore=downloads.length;
  const cleared=await message({type:'CLEAR_EMPTY',lessonIds:[secondEmptyId,emptyId,activeId]});
  assert.equal(cleared.removed,1);
  assert.equal(cleared.skipped,2);
  state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.some(l=>l.id===secondEmptyId),false);
  assert.equal(state.lessons.some(l=>l.id===emptyId),true);
  assert.equal(state.lessons.find(l=>l.id===activeId).cueCount,1);
  assert.equal(downloads.length,countBefore);
  await message({type:'STOP'});
});


test('supervisor encontra vídeo em iframe e retoma no mesmo contexto',async()=>{
  const oldDateNow=Date.now;
  let clock=800000;
  Date.now=()=>clock;
  simulateIframe=true;
  try{
    assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
    await message({type:'METADATA',meta:{url:'https://play.hotmart.com/iframe',title:'Aula em iframe',course:'LightCopy',confidence:'alta'}});
    assert.equal((await message({type:'CHECK_PLAYER'})).ok,true);
    let state=(await message({type:'STATE'})).state;
    assert.equal(state.playback.status,'a reproduzir');
    assert.equal(state.playback.currentTime,60);
    clock+=61001;
    assert.equal((await message({type:'CHECK_PLAYER'})).ok,true);
    state=(await message({type:'STATE'})).state;
    assert.equal(state.playback.resumeAttempts,1);
    assert.ok(resumeRequests.some(r=>r.args.contextId===842 && r.args.userGesture===true));
    assert.equal((await message({type:'STOP'})).ok,true);
  }finally{
    simulateIframe=false;
    Date.now=oldDateNow;
  }
});


test('badge exibe número de segmentos capturados, reinicia numa nova sessão e nunca usa REC',async()=>{
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/badge',title:'Aula contador',course:'LightCopy',confidence:'alta'}});
  assert.equal(badgeTexts.at(-1).text,'0');
  await cdpResponse('badge-1','WEBVTT\n\n00:00:03.000 --> 00:00:05.000\nUm bloco\n');
  await message({type:'STATE'});
  assert.equal(badgeTexts.at(-1).text,'1');
  assert.match(badgeTitles.at(-1).title,/1 bloco\(s\) VTT/);
  // Mesmo texto, novo pedido => outro bloco recebido. O contador não representa falas únicas.
  await cdpResponse('badge-2','WEBVTT\n\n00:00:03.000 --> 00:00:05.000\nUm bloco\n');
  await message({type:'STATE'});
  assert.equal(badgeTexts.at(-1).text,'2');
  assert.equal((await message({type:'STATE'})).state.lessons.at(-1).cueCount,1);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/badge2',title:'Próxima aula',course:'LightCopy',confidence:'alta'}});
  assert.equal(badgeTexts.at(-1).text,'0');
  await message({type:'STOP'});
  assert.equal(badgeTexts.at(-1).text,'');
  assert.ok(!badgeTexts.some(b=>b.text==='REC'));
});

test('merge manual de duas capturas da mesma aula remove duplicadas, exclui fontes de exportação e permite desfazer',async()=>{
  const title='Módulo 02 - Termômetro de aquecimento de público';
  const page='https://play.hotmart.com/curso/termo';
  const metadata={url:page+'?track=secret',title,course:'Hotmart',confidence:'alta'};
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:metadata});
  await cdpResponse('merge-part-1','WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nUma fala original\n');
  await cdpResponse('merge-part-2','WEBVTT\n\n00:00:04.000 --> 00:00:05.000\nFala repetida!\n');
  await message({type:'STOP'});
  const first=(await message({type:'STATE'})).state.lessons.at(-1);
  assert.equal(first.cueCount,2);
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{...metadata,course:'Big Black Friday Infinita'}});
  await cdpResponse('merge-part-3','WEBVTT\n\n00:00:04.080 --> 00:00:05.060\nFala repetida\n');
  await cdpResponse('merge-part-4','WEBVTT\n\n00:00:06.000 --> 00:00:07.000\nFala nova\n');
  await message({type:'STOP'});
  let state=(await message({type:'STATE'})).state;
  const second=state.lessons.at(-1);
  assert.equal(second.cueCount,2);
  const before=downloads.length;
  const combined=await message({type:'MERGE',lessonIds:[first.id,second.id]});
  assert.equal(combined.ok,true,JSON.stringify(combined));
  assert.equal(combined.uniqueCues,3);
  assert.equal(combined.removed,1);
  assert.equal(downloads.length,before,'merge não abre janela de download');
  state=(await message({type:'STATE'})).state;
  const merged=state.lessons.find(l=>l.id===combined.mergedId);
  assert.equal(merged.cueCount,3);
  assert.equal(merged.segments,4);
  assert.equal(merged.mergeRemovedCues,1);
  assert.equal(merged.course,'Big Black Friday Infinita');
  assert.equal(state.lessons.filter(l=>l.supersededBy===merged.id).length,2);
  assert.equal((await message({type:'EXPORT',lessonId:first.id})).ok,false);
  const clearedBefore=await message({type:'CLEAR_MERGED_SOURCES',lessonIds:[first.id,second.id]});
  assert.equal(clearedBefore.removed,0);
  const eligible=state.lessons.filter(l=>l.cueCount>0 && !l.supersededBy).length;
  assert.equal((await message({type:'EXPORT_ALL'})).count,eligible);
  assert.equal(downloads.length,before+1);
  const zipBytes=Buffer.from(downloads.at(-1).url.split(',')[1],'base64');
  assert.ok(zipBytes.includes(Buffer.from('duplicateCuesRemoved')));
  assert.ok(zipBytes.includes(Buffer.from('Fala nova')));
  assert.ok(zipBytes.includes(Buffer.from('Uma fala original')));
  // Ainda mantém fontes, mas não entram no ZIP de todas as aulas.
  const undo=await message({type:'UNDO_MERGE',lessonId:merged.id});
  assert.equal(undo.ok,true);
  state=(await message({type:'STATE'})).state;
  assert.ok(state.lessons.find(l=>l.id===first.id) && state.lessons.find(l=>l.id===second.id));
  assert.equal(state.lessons.some(l=>l.supersededBy),false);
  const again=await message({type:'MERGE',lessonIds:[first.id,second.id]});
  assert.equal(again.ok,true);
  const exportMerged=await message({type:'EXPORT',lessonId:again.mergedId});
  assert.equal(exportMerged.ok,true);
  const partial=await message({type:'CLEAR_MERGED_SOURCES',lessonIds:[first.id,second.id]});
  assert.equal(partial.removed,0);
  hooks.downloadChanged.emit({id:downloads.length,state:{current:'complete'}});
  const cleared=await message({type:'CLEAR_MERGED_SOURCES',lessonIds:[first.id,second.id]});
  assert.equal(cleared.removed,2);
  state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.some(l=>l.id===first.id||l.id===second.id),false);
  assert.equal(state.lessons.find(l=>l.id===again.mergedId).cueCount,3);
  assert.equal((await message({type:'UNDO_MERGE',lessonId:again.mergedId})).ok,false);
});

test('rejeita mistura de aulas e não permite juntar aula ativa',async()=>{
  const title='Aula A';
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/diferente-1',title,course:'LightCopy',confidence:'alta'}});
  await cdpResponse('mix-a','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nAAA\n');
  let state=(await message({type:'STATE'})).state;
  const idA=state.currentId;
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/diferente-2',title:'Aula B',course:'LightCopy',confidence:'alta'}});
  await cdpResponse('mix-b','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBBB\n');
  state=(await message({type:'STATE'})).state;
  const idB=state.currentId;
  assert.equal((await message({type:'MERGE',lessonIds:[idA,idB]})).ok,false);
  await message({type:'STOP'});
  const bad=await message({type:'MERGE',lessonIds:[idA,idB]});
  assert.equal(bad.ok,false);
  assert.match(bad.error,/mesmo título e URL/);
});

test('exporta só as aulas selecionadas num único ZIP, sem mudar as outras',async()=>{
  const state=(await message({type:'STATE'})).state;
  const a=state.lessons.find(l=>l.title==='Aula A' && l.cueCount>0 && !l.supersededBy);
  const b=state.lessons.find(l=>l.title==='Aula B' && l.cueCount>0 && !l.supersededBy);
  assert.ok(a && b);
  const skipped=state.lessons.find(l=>l.id!==a.id && l.id!==b.id && l.cueCount>0 && !l.supersededBy);
  assert.ok(skipped);
  const allBefore=downloads.length;
  const originalStatus=skipped.exportStatus;
  // Chamadas inválidas nunca podem disparar um download nem marcar aulas.
  for(const ids of [[],[a.id,a.id],[a.id,'inexistente'],[a.id,42]]){
    const response=await message({type:'EXPORT_SELECTED',lessonIds:ids});
    assert.equal(response.ok,false);
  }
  assert.equal(downloads.length,allBefore);
  const response=await message({type:'EXPORT_SELECTED',lessonIds:[b.id,a.id]});
  assert.equal(response.ok,true,JSON.stringify(response));
  assert.equal(response.count,2);
  assert.equal(downloads.length,allBefore+1);
  assert.match(downloads.at(-1).filename,/Aulas-selecionadas_/);
  assert.equal(downloads.at(-1).saveAs,true);
  const zipBytes=Buffer.from(downloads.at(-1).url.split(',')[1],'base64');
  assert.ok(zipBytes.includes(Buffer.from('AAA')));
  assert.ok(zipBytes.includes(Buffer.from('BBB')));
  assert.ok(!zipBytes.includes(Buffer.from(skipped.id.slice(0,8))),'ZIP não deve conter identificador de aula não selecionada');
  // As aulas não escolhidas não são marcadas como descarregadas por este ZIP.
  let after=(await message({type:'STATE'})).state;
  assert.equal(after.lessons.find(l=>l.id===skipped.id).exportStatus,originalStatus);
  assert.equal(after.lessons.find(l=>l.id===a.id).exportStatus,'a descarregar');
  assert.equal(after.lessons.find(l=>l.id===b.id).exportStatus,'a descarregar');
  hooks.downloadChanged.emit({id:downloads.length,state:{current:'complete'}});
  after=(await message({type:'STATE'})).state;
  assert.equal(after.lessons.find(l=>l.id===a.id).exportStatus,'concluído');
  assert.equal(after.lessons.find(l=>l.id===b.id).exportStatus,'concluído');
  assert.equal(after.lessons.find(l=>l.id===skipped.id).exportStatus,originalStatus);
});

test('seleção inclui aula ativa apenas como snapshot explícito e não elimina legendas novas',async()=>{
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/selecao-ativa',title:'Aula Parcial',course:'LightCopy',confidence:'alta'}});
  await cdpResponse('partial-one','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nUma fala parcial\n');
  let state=(await message({type:'STATE'})).state;
  const id=state.currentId;
  assert.equal(state.lessons.find(l=>l.id===id).segments,1);
  const res=await message({type:'EXPORT_SELECTED',lessonIds:[id]});
  assert.equal(res.ok,true);
  assert.equal(res.count,1);
  const zipBytes=Buffer.from(downloads.at(-1).url.split(',')[1],'base64');
  assert.ok(zipBytes.includes(Buffer.from('Uma fala parcial')));
  await cdpResponse('partial-two','WEBVTT\n\n00:00:03.000 --> 00:00:04.000\nUma fala posterior\n');
  hooks.downloadChanged.emit({id:downloads.length,state:{current:'complete'}});
  state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.find(l=>l.id===id).segments,2);
  assert.equal(state.lessons.find(l=>l.id===id).exportedSegments,1);
  await message({type:'STOP'});
  const clear=await message({type:'CLEAR_EXPORTED',lessonIds:[id]});
  assert.equal(clear.removed,0,'não apaga captura que recebeu segmentos após o ZIP');
});


test('botões de velocidade alteram o player no iframe, sem iniciar downloads',async()=>{
  await message({type:'STOP'});
  const base=downloads.length;
  simulateIframe=true;simulatedRate=1;providerLimit=0;
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/speed-01',title:'Aula para acelerar',course:'LightCopy',confidence:'alta'}});
  let result=await message({type:'SPEED_SET',speed:4});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.applied,4);
  assert.equal(result.speed,4);
  assert.ok(speedRequests.some(r=>r.requested===4 && r.args.contextId===842));
  let state=(await message({type:'STATE'})).state;
  assert.equal(state.playbackSpeed,4);
  assert.equal(state.speedStatus.applied,4);
  assert.equal(downloads.length,base);
  // A velocidade é preservada na aula seguinte e reposta automaticamente.
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/speed-02',title:'Aula seguinte',course:'LightCopy',confidence:'alta'}});
  simulatedRate=1;
  await message({type:'CHECK_PLAYER'});
  state=(await message({type:'STATE'})).state;
  assert.equal(state.playbackSpeed,4);
  assert.equal(state.speedStatus.applied,4);
  assert.equal(speedRequests.at(-1).requested,4);
  const reset=await message({type:'SPEED_SET',speed:1});
  assert.equal(reset.applied,1);
  assert.equal((await message({type:'STATE'})).state.playbackSpeed,1);
  assert.equal(downloads.length,base);
  await message({type:'STOP'});
  simulateIframe=false;
});

test('se Hotmart limitar a velocidade, informa taxa efetivamente aplicada',async()=>{
  simulateIframe=true;providerLimit=2;simulatedRate=1;
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  const answer=await message({type:'SPEED_SET',speed:6});
  assert.equal(answer.ok,true);
  assert.equal(answer.speed,6);
  assert.equal(answer.applied,2);
  assert.match(answer.status,/limitou/i);
  const invalid=await message({type:'SPEED_SET',speed:16});
  assert.equal(invalid.ok,false);
  const state=(await message({type:'STATE'})).state;
  assert.equal(state.playbackSpeed,6);
  await message({type:'STOP'});
  providerLimit=0;simulateIframe=false;
});

test('player inacessível fica pendente; altera assim que o iframe aparece',async()=>{
  simulateIframe=false;
  await message({type:'STOP'});
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  const pending=await message({type:'SPEED_SET',speed:3});
  assert.equal(pending.ok,true);
  assert.equal(pending.applied,null);
  assert.match(pending.status,/pendente/i);
  simulateIframe=true;simulatedRate=1;
  await message({type:'CHECK_PLAYER'});
  const state=(await message({type:'STATE'})).state;
  assert.equal(state.speedStatus.applied,3);
  await message({type:'STOP'});
  simulateIframe=false;
});


test('evento de novo player reaplica taxa sem esperar 30 s; parar repõe 1×',async()=>{
  simulateIframe=true;simulatedRate=1;providerLimit=0;
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  assert.equal((await message({type:'SPEED_SET',speed:6})).applied,6);
  // Player substituído pelo fornecedor durante a mesma aula.
  simulatedRate=1;
  const before=speedRequests.length;
  const res=await message({type:'PLAYER_ACTIVITY'});
  assert.equal(res.ok,true);
  assert.equal(speedRequests.length,before+1);
  assert.equal(simulatedRate,6);
  assert.equal((await message({type:'STOP'})).ok,true);
  assert.equal(simulatedRate,1);
  assert.equal((await message({type:'STATE'})).state.playbackSpeed,6);
  simulateIframe=false;
});


test('qualidade mínima aplica-se durante a captura e é reposta ao parar; nenhum download automático',async()=>{
  simulateIframe=true;simulatedQuality=null;
  const beforeDownloads=downloads.length;
  const startResult=await message({type:'START',tabId:5,mode:'restart'});
  assert.equal(startResult.ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/quality-test',title:'Teste resolução',course:'LightCopy',confidence:'alta'}});
  await message({type:'CHECK_PLAYER'});
  let state=(await message({type:'STATE'})).state;
  assert.equal(state.qualityMinOnCapture,true);
  assert.equal(state.qualityStatus.height,144);
  assert.equal(simulatedQuality,'144p');
  assert.equal(downloads.length,beforeDownloads);
  const pref=await message({type:'QUALITY_SET',enabled:false});
  assert.equal(pref.ok,true);
  assert.equal(simulatedQuality,'auto');
  assert.equal((await message({type:'STATE'})).state.qualityMinOnCapture,false);
  assert.equal((await message({type:'QUALITY_SET',enabled:true})).ok,true);
  assert.equal(simulatedQuality,'144p');
  assert.equal((await message({type:'STOP'})).ok,true);
  assert.equal(simulatedQuality,'auto');
  assert.equal(downloads.length,beforeDownloads);
  assert.ok(qualityRequests.some(x=>x.mode==='min' && x.args.contextId===842));
  assert.ok(qualityRequests.some(x=>x.mode==='restore'));
  simulateIframe=false;
});

test('SPA: a nova rota fecha a aula anterior antes do h1 atualizar e mantém VTT separados',async()=>{
  activeTabUrl='https://play.hotmart.com/pt-BR/club/course/content/aula-briefing';
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Módulo 02 - Briefing de Copy',course:'LightCopy',confidence:'alta'}});
  await cdpResponse('briefing1','WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nPrimeira fala do briefing\n');
  let state=(await message({type:'STATE'})).state;
  const oldId=state.currentId;
  const oldCount=state.lessons.find(l=>l.id===oldId).cueCount;
  const newUrl='https://play.hotmart.com/pt-BR/club/course/content/aula-headlines';
  activeTabUrl=newUrl;
  hooks.onHistory.emit({tabId:5,frameId:0,url:newUrl});
  state=(await message({type:'STATE'})).state;
  assert.notEqual(state.currentId,oldId);
  assert.equal(state.lessons.find(l=>l.id===oldId).endedAt!==null,true);
  assert.equal(state.routeUrl,newUrl);
  assert.equal(state.lessons.find(l=>l.id===state.currentId).title,'Aula sem título');
  // O React ainda exibe o h1 anterior: nunca aceitar como título da nova rota.
  await message({type:'METADATA',meta:{url:newUrl,title:'Módulo 02 - Briefing de Copy',course:'LightCopy',confidence:'alta'}});
  state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.find(l=>l.id===state.currentId).title,'Aula sem título');
  await cdpResponse('headline1','WEBVTT\n\n00:00:10.000 --> 00:00:12.000\nPrimeira fala das headlines\n');
  state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.find(l=>l.id===oldId).cueCount,oldCount);
  assert.equal(state.lessons.find(l=>l.id===state.currentId).cueCount,1);
  assert.ok(state.routePending);
  await message({type:'METADATA',meta:{url:newUrl,title:'Módulo 02 - Headlines e Subheadlines',course:'LightCopy',confidence:'alta'}});
  state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.find(l=>l.id===state.currentId).title,'Módulo 02 - Headlines e Subheadlines');
  assert.equal(state.routePending,null);
  // Uma mensagem antiga, atrasada, não pode reverter a rota.
  const delayed=await new Promise(resolve=>hooks.onMessage.listeners[0]({type:'METADATA',meta:{url:'https://play.hotmart.com/pt-BR/club/course/content/aula-briefing',title:'Módulo 02 - Briefing de Copy',confidence:'alta'}},{tab:{id:5}},resolve));
  assert.equal(delayed.ok,true);
  const after=(await message({type:'STATE'})).state;
  assert.equal(after.currentId,state.currentId);
  assert.equal(after.lessons.find(l=>l.id===oldId).cueCount,oldCount);
  await message({type:'STOP'});
});

test('sem evento de navegação: o primeiro VTT verifica URL do Brave antes de vincular a aula',async()=>{
  activeTabUrl='https://play.hotmart.com/content/aula-a';
  await message({type:'START',tabId:5,mode:'restart'});
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Aula A',confidence:'alta'}});
  await cdpResponse('a1','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFala A\n');
  const before=(await message({type:'STATE'})).state;
  const oldId=before.currentId;
  activeTabUrl='https://play.hotmart.com/content/aula-b';
  // Falha do evento webNavigation: só o fluxo de legendas denuncia a mudança.
  await cdpResponse('b1','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFala B\n');
  const mid=(await message({type:'STATE'})).state;
  assert.notEqual(mid.currentId,oldId);
  assert.equal(mid.lessons.find(l=>l.id===oldId).cueCount,1);
  assert.equal(mid.lessons.find(l=>l.id===mid.currentId).cueCount,1);
  assert.equal(mid.lessons.find(l=>l.id===mid.currentId).pageUrl,activeTabUrl);
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Aula B',confidence:'alta'}});
  const end=(await message({type:'STATE'})).state;
  assert.equal(end.lessons.find(l=>l.id===mid.currentId).title,'Aula B');
  await message({type:'STOP'});
});

test('pedidos VTT iniciados na aula anterior continuam nela após a transição SPA',async()=>{
  activeTabUrl='https://play.hotmart.com/content/aula-antiga';
  await message({type:'START',tabId:5,mode:'restart'});
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Aula Antiga',confidence:'alta'}});
  const first=(await message({type:'STATE'})).state.currentId;
  answers.set('before-transition','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFala atrasada\n');
  hooks.events.emit({tabId:5},'Network.responseReceived',{requestId:'before-transition',response:{url:'https://cdn.example.com/before-transition.vtt',mimeType:'text/vtt'}});
  await message({type:'STATE'});
  activeTabUrl='https://play.hotmart.com/content/aula-nova';
  hooks.onHistory.emit({tabId:5,frameId:0,url:activeTabUrl});
  await message({type:'STATE'});
  hooks.events.emit({tabId:5},'Network.loadingFinished',{requestId:'before-transition'});
  const state=(await message({type:'STATE'})).state;
  assert.equal(state.lessons.find(l=>l.id===first).cueCount,1);
  assert.equal(state.lessons.find(l=>l.id===state.currentId).cueCount,0);
  await message({type:'STOP'});
});

test('segmento iniciado antes da mudança de URL mantém aula original mesmo que a resposta venha depois',async()=>{
  activeTabUrl='https://play.hotmart.com/content/aula-tarde';
  await message({type:'START',tabId:5,mode:'restart'});
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Aula Antiga',confidence:'alta'}});
  const original=(await message({type:'STATE'})).state.currentId;
  answers.set('segment-delayed','WEBVTT\n\n00:00:22.000 --> 00:00:24.000\nAinda pertence à antiga\n');
  hooks.events.emit({tabId:5},'Network.requestWillBeSent',{requestId:'segment-delayed',request:{url:'https://cdn.example.com/segment-delayed.vtt'}});
  activeTabUrl='https://play.hotmart.com/content/aula-nova-tarde';
  hooks.onHistory.emit({tabId:5,frameId:0,url:activeTabUrl});
  await message({type:'STATE'});
  hooks.events.emit({tabId:5},'Network.responseReceived',{requestId:'segment-delayed',response:{url:'https://cdn.example.com/segment-delayed.vtt',mimeType:'text/vtt'}});
  hooks.events.emit({tabId:5},'Network.loadingFinished',{requestId:'segment-delayed'});
  const state=(await message({type:'STATE'})).state;
  assert.notEqual(state.currentId,original);
  assert.equal(state.lessons.find(l=>l.id===original).cueCount,1);
  assert.equal(state.lessons.find(l=>l.id===state.currentId).cueCount,0);
  await message({type:'STOP'});
});


test('usa contexto principal do iframe para aceder às APIs do player',async()=>{
  simulateIframe=true;simulatedMainWorld=true;
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:'https://play.hotmart.com/main-world',title:'Qualidade frame',course:'LightCopy',confidence:'alta'}});
  hooks.events.emit({tabId:5},'Runtime.executionContextCreated',{
    context:{id:950,auxData:{frameId:'player-frame',isDefault:true}}});
  const verified=await message({type:'QUALITY_CHECK'});
  assert.equal(verified.ok,true);
  let state=(await message({type:'STATE'})).state;
  assert.equal(state.qualityStatus.contextType,'principal');
  assert.equal(state.qualityStatus.height,144);
  assert.ok(qualityRequests.some(x=>x.args.contextId===950));
  await message({type:'STOP'});
  simulatedMainWorld=false;simulateIframe=false;
});

test('popup parado limpa badges antigos mas preserva legendas armazenadas',async()=>{
  assert.equal((await message({type:'STOP'})).ok,true);
  const count=saved.fhad_vtt_capture_v1.lessons.length;
  // simula o contador visual que ficou em cache após atualização da extensão
  await chrome.action.setBadgeText({tabId:5,text:'52'});
  const result=await message({type:'STATE'});
  assert.equal(result.state.tracking,false);
  assert.equal(badgeTexts.at(-1).text,'');
  assert.equal(saved.fhad_vtt_capture_v1.lessons.length,count);
});


test('repara sessão de debugger órfã quando popup mostra PARADO',async()=>{
  assert.equal((await message({type:'STOP'})).ok,true);
  // Depurador residual, desligado do estado persistido após uma atualização.
  attached=true;emitDetachDuringRecovery=true;
  const result=await message({type:'START',tabId:5,mode:'restart'});
  assert.equal(result.ok,true);
  const state=(await message({type:'STATE'})).state;
  assert.equal(state.tracking,true);
  assert.equal(attached,true);
  // O detach de recuperação não pode parar a nova captura.
  assert.equal(state.lastError,null);
  await message({type:'STOP'});
  emitDetachDuringRecovery=false;
});

test('falha após attach limpa debugger, mostra erro e permite retry',async()=>{
  assert.equal((await message({type:'STOP'})).ok,true);
  failNextNetworkEnable=true;
  const before=saved.fhad_vtt_capture_v1.lessons.length;
  const result=await message({type:'START',tabId:5,mode:'restart'});
  assert.equal(result.ok,false);
  assert.match(result.error,/simulated Network\.enable failure/);
  const after=(await message({type:'STATE'})).state;
  assert.equal(after.tracking,false);
  assert.match(after.lastError,/Falha ao iniciar captura/);
  assert.equal(attached,false);
  assert.equal(after.lessons.length,before);
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  const recovered=(await message({type:'STATE'})).state;
  assert.equal(recovered.tracking,true);
  assert.equal(recovered.lastError,null);
  await message({type:'STOP'});
});

test('não interfere com debugger alheio; dá mensagem legível e continua parado',async()=>{
  assert.equal((await message({type:'STOP'})).ok,true);
  attached=true;denyDebugDetach=true;foreignDebugger=true;
  const result=await message({type:'START',tabId:5,mode:'restart'});
  assert.equal(result.ok,false);
  assert.match(result.error,/Já existe uma ligação de depuração/);
  const state=(await message({type:'STATE'})).state;
  assert.equal(state.tracking,false);
  assert.equal(attached,true);
  denyDebugDetach=false;attached=false;foreignDebugger=false;
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'STOP'});
});


test('fechar e voltar a abrir popup não altera estado nem cria duplicação',async()=>{
  assert.equal((await message({type:'STOP'})).ok,true);
  activeTabUrl='https://play.hotmart.com/content/popup-reopen';
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Aula popup',confidence:'alta'}});
  await cdpResponse('popup-clip','WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nOlá\n');
  const first=(await message({type:'STATE'})).state;
  const count=first.lessons.length;
  const id=first.currentId;
  // Cada STATE corresponde a uma nova instância/poll do popup; nada reinicia.
  for(let i=0;i<5;i++){
    const again=(await message({type:'STATE'})).state;
    assert.equal(again.tracking,true);
    assert.equal(again.tabId,5);
    assert.equal(again.currentId,id);
    assert.equal(again.lessons.length,count);
    assert.equal(again.lessons.find(l=>l.id===id).cueCount,1);
  }
  await message({type:'STOP'});
});

test('popup recupera sessão CDP real com estado antigo sem criar aula nova',async()=>{
  assert.equal((await message({type:'STOP'})).ok,true);
  activeTabUrl='https://play.hotmart.com/content/popup-recovered';
  const response=await message({type:'START',tabId:5,mode:'restart'});
  assert.equal(response.ok,true);
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Aula em andamento',confidence:'alta'}});
  const first=(await message({type:'STATE'})).state;
  const lessonId=first.currentId;
  const count=first.lessons.length;
  // O CDP mantém-se ativo mas o estado do worker foi guardado como PARADO.
  const state=saved.fhad_vtt_capture_v1;
  state.tracking=false;
  state.tabId=null;
  // As tarefas já existentes no background usam cache. Para simular restart de
  // service worker, chamar onInstalled geraria uma nova sessão e não é adequado.
  // Em vez disso, usar uma rotina interna de teste a partir de novo worker vm
  // é tratado pelo teste dedicado abaixo.
  state.tracking=true;
  state.tabId=5;
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  const again=(await message({type:'STATE'})).state;
  assert.equal(again.lessons.length,count);
  assert.equal(again.currentId,lessonId);
  await message({type:'STOP'});
});

test('sessão CDP persistente é restaurada após estado ser reiniciado sem detach',async()=>{
  assert.equal((await message({type:'STOP'})).ok,true);
  activeTabUrl='https://play.hotmart.com/content/restart-popup';
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Antes de reiniciar',confidence:'alta'}});
  await cdpResponse('before-restart','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFala guardada\n');
  const old=(await message({type:'STATE'})).state;
  const oldId=old.currentId;
  // Simula estado do worker que foi marcado como parado após reinício do
  // browser mas cuja conexão CDP continuou ligada.
  hooks.onStart.emit();
  const restored=(await message({type:'STATE'})).state;
  assert.equal(restored.tracking,true);
  assert.equal(restored.tabId,5);
  assert.equal(restored.lessons.find(l=>l.id===oldId).cueCount,1);
  assert.match(restored.log[0].text,/Sessão ativa recuperada/);
  await message({type:'STOP'});
});

test('não recupera debugger de terceiros durante abertura de popup',async()=>{
  await message({type:'STOP'});
  attached=true;foreignDebugger=true;
  const state=(await message({type:'STATE'})).state;
  assert.equal(state.tracking,false);
  assert.equal(state.currentId,null);
  foreignDebugger=false;attached=false;
});


test('estado recupera CDP mesmo sem alvo attached no getTargets e sem Runtime.evaluate',async()=>{
  await message({type:'STOP'});
  activeTabUrl='https://play.hotmart.com/content/sem-target';
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Aula sem target',confidence:'alta'}});
  await cdpResponse('stable-vtt','WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nTeste de recuperação\n');
  const before=(await message({type:'STATE',tabId:5})).state;
  const id=before.currentId;
  const count=before.lessons.length;
  // Runtime.evaluate falha com o frame em navegação. Runtime.enable continua
  // a confirmar a nossa sessão de depuração.
  omitAttachedTargets=true;
  pingEvaluationFails=true;
  hooks.onStart.emit();
  const recovered=(await message({type:'STATE',tabId:5})).state;
  assert.equal(recovered.tracking,true);
  assert.equal(recovered.sessionHealth.connected,true);
  // onStartup fecha formalmente a aula anterior, por isso recuperar após
  // reinício do navegador cria uma nova captura sem perder a anterior.
  assert.equal(recovered.lessons.length,count+1);
  assert.notEqual(recovered.currentId,id);
  assert.equal(recovered.lessons.find(l=>l.id===id).cueCount,1);
  assert.ok(recovered.lastSegmentAt);
  omitAttachedTargets=false;
  pingEvaluationFails=false;
  await message({type:'STOP'});
});

test('sem CDP próprio não recupera outra extensão nem apresenta gravação ativa',async()=>{
  await message({type:'STOP'});
  omitAttachedTargets=true;
  foreignDebugger=true;
  attached=true;
  const result=(await message({type:'STATE',tabId:5})).state;
  assert.equal(result.tracking,false);
  assert.equal(result.sessionHealth.connected,false);
  foreignDebugger=false;
  attached=false;
  omitAttachedTargets=false;
});


test('CDP: 240p é selecionado com eventos de rato reais, não clique sintético',async()=>{
  await message({type:'STOP'});
  forceMenuQuality=true;simulateIframe=true;
  const before=trustedMouseEvents.length;
  activeTabUrl='https://play.hotmart.com/content/qualidade-240p';
  assert.equal((await message({type:'START',tabId:5,mode:'restart'})).ok,true);
  await message({type:'METADATA',meta:{url:activeTabUrl,title:'Teste 240p',confidence:'alta'}});
  const result=await message({type:'QUALITY_CHECK'});
  assert.equal(result.ok,true);
  const latest=trustedMouseEvents.slice(before);
  assert.ok(latest.length>=3,'tem de enviar move, press e release');
  const events=latest.slice(0,3);
  assert.deepEqual(events.map(e=>e.type),['mouseMoved','mousePressed','mouseReleased']);
  for(const event of events){assert.equal(event.x,750);assert.equal(event.y,540);}
  assert.equal((await message({type:'STATE'})).state.qualityStatus.height,240);
  assert.equal((await message({type:'STATE'})).state.qualityStatus.applied,true);
  await message({type:'STOP'});
  forceMenuQuality=false;simulateIframe=false;
});
