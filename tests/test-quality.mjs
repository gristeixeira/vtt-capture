import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {qualityExpression} from '../lib/quality.js';

function fakePage({hls,videojs}={}){
  const video={duration:180,readyState:4,paused:false,currentSrc:'blob:course-1',id:'video1'};
  if(hls){hls.media=video;video.hls=hls;}
  const document={querySelectorAll(selector){return selector==='video'?[video]:[];}};
  const global={document,videojs,Symbol,WeakMap,Set,Number,Array};
  global.globalThis=global;
  return {video,global,evaluate:mode=>vm.runInNewContext(qualityExpression(mode),global)};
}

test('hls.js: escolhe a resolução mais baixa, sem alterar o VTT, e repõe estado anterior',()=>{
  const hls={currentLevel:-1,levels:[{height:1080,bitrate:5000000},{height:144,bitrate:220000},{height:360,bitrate:700000}]};
  const page=fakePage({hls});
  const low=page.evaluate('min');
  assert.equal(low.found,true);
  assert.equal(low.applied,true);
  assert.equal(low.height,144);
  assert.equal(hls.currentLevel,1);
  // Segunda passagem não altera a definição anterior guardada.
  assert.equal(page.evaluate('min').applied,true);
  assert.equal(page.evaluate('restore').restored,true);
  assert.equal(hls.currentLevel,-1);
});

test('video.js: usa qualityLevels e restaura seleção original',()=>{
  const levels=[{height:480,bitrate:2000,enabled:true},{height:144,bitrate:200,enabled:true},{height:1080,bitrate:5000,enabled:false}];
  const page=fakePage({videojs:()=>{},hls:null});
  page.global.videojs.getPlayer=()=>({qualityLevels:()=>levels});
  const low=page.evaluate('min');
  assert.equal(low.provider,'video.js');
  assert.equal(low.height,144);
  assert.deepEqual(levels.map(x=>x.enabled),[false,true,false]);
  assert.equal(page.evaluate('restore').restored,true);
  assert.deepEqual(levels.map(x=>x.enabled),[true,true,false]);
});

test('player sem controlador conhecido permanece inalterado e informa limitação',()=>{
  const page=fakePage();
  const result=page.evaluate('min');
  assert.equal(result.applied,false);
  assert.equal(result.unsupported,true);
  assert.match(result.status,/não disponibiliza/i);
  assert.equal(page.evaluate('restore').restored,true);
});

test('nenhum vídeo não provoca exceção; modo inválido é rejeitado',()=>{
  const page=fakePage();
  page.global.document.querySelectorAll=()=>[];
  assert.equal(page.evaluate('min').found,false);
  assert.throws(()=>qualityExpression('network-throttling'));
});

test('não mexe nas APIs de rede nem descarrega legendas',()=>{
  const source=qualityExpression('min');
  assert.doesNotMatch(source,/Network\.emulateNetworkConditions|fetch\(|XMLHttpRequest|download\(/);
});


test('JW Player: escolhe menor nível visível e repõe escolha anterior',()=>{
  const page=fakePage();
  let current=0;
  const jw={getContainer:()=>({contains:v=>v===page.video}),getQualityLevels:()=>[
    {label:'1080p',bitrate:4500000},{label:'240p',bitrate:300000},{label:'720p',bitrate:1500000}],
    getCurrentQuality:()=>current,setCurrentQuality:i=>{current=i;}};
  const factory=()=>jw;
  page.global.jwplayer=factory;
  const result=page.evaluate('min');
  assert.equal(result.applied,true);
  assert.equal(result.provider,'jwplayer');
  assert.equal(result.height,240);
  assert.equal(current,1);
  assert.equal(page.evaluate('restore').restored,true);
  assert.equal(current,0);
});

test('qualidade indisponível não anuncia uma resolução falsa',()=>{
  const page=fakePage();
  page.video.videoHeight=720;
  const result=page.evaluate('min');
  assert.equal(result.applied,false);
  assert.equal(result.observedHeight,720);
  assert.match(result.status,/não alterada/i);
});
