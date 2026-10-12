import test from 'node:test';
import assert from 'node:assert/strict';
import {frameIds,probeDebuggerTarget} from '../lib/player-probe.js';

const video={currentTime:75.5,duration:120,paused:false,ended:false,readyState:4,trackId:'lesson-player'};

test('descobre frames aninhados e evita identificadores repetidos',()=>{
  assert.deepEqual(frameIds({frame:{id:'main'},childFrames:[
    {frame:{id:'sub'},childFrames:[{frame:{id:'stream'}}]},
    {frame:{id:'sub'}}
  ]}),['main','sub','stream']);
});

test('recupera reprodução em iframe do mesmo processo via mundo isolado',async()=>{
  const calls=[];
  const send=async(target,method,args)=>{
    calls.push({target,method,args});
    if(method==='Runtime.evaluate')return {result:{value:args.contextId===203?video:null}};
    if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'},childFrames:[{frame:{id:'embedded-video'}}]}};
    if(method==='Page.createIsolatedWorld')return {executionContextId:args.frameId==='embedded-video'?203:101};
    throw Error('comando desconhecido');
  };
  const result=await probeDebuggerTarget(send,{tabId:5},'(() => null)()');
  assert.equal(result.probes.length,1);
  assert.equal(result.probes[0].currentTime,75.5);
  assert.equal(result.probes[0].score,25);
  assert.equal(result.scanned,3);
  assert.ok(calls.some(c=>c.method==='Runtime.evaluate' && c.args.contextId===203));
  assert.ok(calls.every(c=>c.target.tabId===5));
});

test('suporta iframes inacessíveis sem reportar vídeo falso',async()=>{
  const send=async(_,method)=>{
    if(method==='Runtime.evaluate')throw Error('Frame navigated');
    if(method==='Page.getFrameTree')return {frameTree:{frame:{id:'main'},childFrames:[{frame:{id:'iframe'}}]}};
    if(method==='Page.createIsolatedWorld')throw Error('Target detached');
  };
  const result=await probeDebuggerTarget(send,{tabId:5},'() => 0');
  assert.equal(result.probes.length,0);
  assert.equal(result.scanned,1);
});

test('consulta apenas o contexto principal quando o vídeo já foi encontrado',async()=>{
  const called=[];
  const send=async(_,method)=>{called.push(method);if(method==='Runtime.evaluate')return {result:{value:video}};throw Error('não chamar');};
  const result=await probeDebuggerTarget(send,{tabId:5},'video');
  assert.equal(result.probes.length,1);
  assert.deepEqual(called,['Runtime.evaluate']);
});
