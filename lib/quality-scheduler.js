// Uma única tentativa automática por aula, ASSIM QUE o vídeo começar a reproduzir.
// "Verificar qualidade agora" ignora este agendamento e continua manualmente disponível.
export const QUALITY_READY_DELAY_MS=0;
export function autoQualityDecision(state, probe, at=Date.now(), delay=QUALITY_READY_DELAY_MS){
  if(!state?.currentId || !probe) return {action:'none'};
  let entry=state.qualityAuto;
  if(!entry || entry.lessonId!==state.currentId){
    entry={lessonId:state.currentId,trackId:null,readySince:0,attempted:false};
    state.qualityAuto=entry;
  }
  if(entry.attempted)return {action:'done'};
  // O player pode estar pronto no PRIMEIRO frame (currentTime===0).
  // Bastam metadados/imagem inicial e reprodução não pausada: esperar 
  // 3 segundos ou readyState>=3 atrasava a seleção durante muitos segundos.
  if(probe.paused || probe.ended || Number(probe.readyState)<2 ||
     !Number.isFinite(probe.currentTime) || probe.currentTime<0){
    entry.readySince=0;
    return {action:'wait'};
  }
  if(delay<=0){
    entry.trackId=probe.trackId;
    entry.attempted=true;
    entry.attemptedAt=at;
    return {action:'attempt'};
  }
  if(!entry.readySince || entry.trackId!==probe.trackId){
    entry.trackId=probe.trackId;
    entry.readySince=at;
    return {action:'schedule',after:delay};
  }
  const remaining=delay-(at-entry.readySince);
  if(remaining>0)return {action:'schedule',after:remaining};
  // Marcar ANTES da chamada assíncrona: nem um erro do player autoriza
  // tentativas repetidas em alarmes ou em eventos PLAYER_ACTIVITY.
  entry.attempted=true;
  entry.attemptedAt=at;
  return {action:'attempt'};
}
export function acknowledgeManualQuality(state){
  if(state?.currentId)state.qualityAuto={lessonId:state.currentId,trackId:null,readySince:0,attempted:true,attemptedAt:Date.now(),manual:true};
}
