import test from 'node:test';
import assert from 'node:assert/strict';
import {playbackDecision} from '../lib/watchdog.js';
const probe=(t,d=100,paused=false,ended=false,track='clip-1')=>({trackId:track,currentTime:t,duration:d,paused,ended});
test('não salta um vídeo que continua a avançar nem um vídeo pausado pelo utilizador',()=>{
  let s=playbackDecision({},probe(10),100000).state;
  let r=playbackDecision(s,probe(80),210000);
  assert.equal(r.action,null);
  r=playbackDecision(r.state,probe(80,100,true),400000);
  assert.equal(r.action,null);
  assert.equal(r.state.status,'vídeo pausado');
});
test('tenta retomar só após 60 segundos sem progresso durante reprodução e limita tentativas',()=>{
  let s=playbackDecision({},probe(30),100000).state;
  let r=playbackDecision(s,probe(30),161001);
  assert.equal(r.action,'resume');
  r=playbackDecision(r.state,probe(30),222003);
  assert.equal(r.action,'resume');
  r=playbackDecision(r.state,probe(30),283005);
  assert.equal(r.action,null);
  assert.equal(r.state.status,'reprodução bloqueada — intervenção necessária');
});
test('no fim aguarda mudança automática da Hotmart antes de tentar próximo e limita a duas ações',()=>{
  let s=playbackDecision({},probe(100,100,true,true),100000).state;
  let r=playbackDecision(s,probe(100,100,true,true),112001);
  assert.equal(r.action,'next');
  r=playbackDecision(r.state,probe(100,100,true,true),124002);
  assert.equal(r.action,'next');
  r=playbackDecision(r.state,probe(100,100,true,true),150000);
  assert.equal(r.action,null);
  assert.match(r.state.status,/não confirmado/);
});
test('mudar de vídeo reinicia os contadores e não transporta tentativas',()=>{
  let s=playbackDecision({},probe(100,100,true,true),100000).state;
  s=playbackDecision(s,probe(100,100,true,true),112001).state;
  let r=playbackDecision(s,probe(1,90,false,false,'clip-2'),115000);
  assert.equal(r.state.advanceAttempts,0);
  assert.equal(r.state.status,'a reproduzir');
});
