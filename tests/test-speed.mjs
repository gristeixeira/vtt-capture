import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {checkedSpeed,matchesSpeed,speedExpression} from '../lib/speed.js';

test('permite apenas velocidades previstas e rejeita valores arbitrários',()=>{
  for(const value of [1,2,3,4,6,'4'])assert.equal(checkedSpeed(value),Number(value));
  for(const value of [0,-1,1.3,2.7,8,16,NaN,Infinity,undefined,null])assert.throws(()=>checkedSpeed(value));
  assert.equal(matchesSpeed(3.99,4),true);
  assert.equal(matchesSpeed(2,4),false);
});

function player({accept=true}={}){
  let rate=1;
  const video={duration:120,readyState:4,paused:false};
  Object.defineProperty(video,'playbackRate',{get:()=>rate,set(v){rate=accept?v:Math.min(2,v)}});
  Object.defineProperty(video,'defaultPlaybackRate',{get:()=>rate,set(v){rate=accept?v:Math.min(2,v)}});
  const document={querySelectorAll(sel){return sel==='video'?[video]:[];}};
  return {video,document};
}
test('comandos de velocidade modificam o HTMLVideoElement da aula sem clicar em botões',()=>{
  const ctx=player();
  const result=runInNewContext(speedExpression(4),{document:ctx.document,Set,Number,isFinite});
  assert.equal(result.found,true);
  assert.equal(result.rate,4);
  assert.equal(ctx.video.playbackRate,4);
  const reset=runInNewContext(speedExpression(1),{document:ctx.document,Set,Number,isFinite});
  assert.equal(reset.rate,1);
});
test('deteta que o fornecedor limita a velocidade a 2×',()=>{
  const ctx=player({accept:false});
  const result=runInNewContext(speedExpression(6),{document:ctx.document,Set,Number,isFinite});
  assert.equal(result.found,true);
  assert.equal(result.rate,2);
  assert.equal(matchesSpeed(result.rate,6),false);
});
test('player ausente não declara velocidade aplicada',()=>{
  const document={querySelectorAll(){return []}};
  const result=runInNewContext(speedExpression(3),{document,Set,Number,isFinite});
  assert.equal(result.found,false);
});
