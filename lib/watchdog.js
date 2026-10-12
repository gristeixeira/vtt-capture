// Política do supervisor: nunca salta uma aula a meio por falta de legendas.
export function playbackDecision(previous,probe,time,{resumeAfterMs=60000,advanceAfterMs=12000,maxRetries=2}={}){
  const out={...previous};
  if(!probe || !Number.isFinite(probe.currentTime))return {state:out,action:null};
  const current=Number(probe.currentTime);
  const duration=Number(probe.duration);
  const sameTrack=out.trackId===probe.trackId && out.trackId!==undefined;
  if(!sameTrack){const endNotification=out.trackId===undefined?out.endedSince:null;out.trackId=probe.trackId;out.lastTime=current;out.lastProgressAt=time;out.endedSince=endNotification||null;out.advanceAttempts=0;out.resumeAttempts=0;out.lastRecoveryAt=0;out.lastAdvanceAt=0;}
  else if(current>Number(out.lastTime||0)+0.4){out.lastProgressAt=time;out.lastTime=current;out.endedSince=null;out.resumeAttempts=0;}
  else if(current < Number(out.lastTime||0)-2){ // utilizador voltou atrás ou player reiniciou
    out.lastTime=current;out.lastProgressAt=time;out.endedSince=null;out.resumeAttempts=0;out.advanceAttempts=0;
  }
  out.lastProbeAt=time;out.currentTime=current;out.duration=Number.isFinite(duration)?duration:null;
  out.paused=Boolean(probe.paused);out.ended=Boolean(probe.ended);
  const endReached=Boolean(probe.ended) || (Number.isFinite(duration)&&duration>0&&current>=duration-0.8&&probe.paused);
  if(endReached){
    if(!out.endedSince)out.endedSince=time;
    out.status='fim do vídeo — a aguardar mudança de aula';
    if(time-out.endedSince>=advanceAfterMs && out.advanceAttempts<maxRetries && time-(out.lastAdvanceAt||0)>=advanceAfterMs){
      out.advanceAttempts++;out.lastAdvanceAt=time;return {state:out,action:'next'};
    }
    if(out.advanceAttempts>=maxRetries)out.status='fim do vídeo — avanço automático não confirmado';
    return {state:out,action:null};
  }
  out.endedSince=null;
  if(out.paused){out.status='vídeo pausado';return {state:out,action:null};}
  if(time-(out.lastProgressAt||time)>=resumeAfterMs){
    out.status='reprodução sem progresso — a tentar retomar';
    if(out.resumeAttempts<maxRetries && time-(out.lastRecoveryAt||0)>=resumeAfterMs){
      out.resumeAttempts++;out.lastRecoveryAt=time;return {state:out,action:'resume'};
    }
    if(out.resumeAttempts>=maxRetries)out.status='reprodução bloqueada — intervenção necessária';
    return {state:out,action:null};
  }
  out.status='a reproduzir';return {state:out,action:null};
}
