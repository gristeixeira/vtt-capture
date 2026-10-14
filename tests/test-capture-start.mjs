import test from 'node:test';
import assert from 'node:assert/strict';
import {previousCaptures,captureStartDecision,normalizeCaptureUrl} from '../lib/capture-start.js';

const url='https://play.hotmart.com/aula-123?token=private';
const captures=[{id:'cap1',title:'Aula',pageUrl:'https://play.hotmart.com/aula-123?session=other',
  startedAt:'2026-10-13T08:00:00Z',segments:10,cues:[{start:1000,end:20000},{start:20000,end:30000}]}];

test('nova aula sem histórico começa sempre em zero',()=>{
 assert.deepEqual(captureStartDecision([],url,'fresh'),{kind:'new',seconds:0});
});
test('histórico da mesma URL exige escolha explícita',()=>{
 assert.equal(previousCaptures(captures,url).length,1);
 assert.throws(()=>captureStartDecision(captures,url,'fresh'),/Já existe uma captura/);
 assert.deepEqual(captureStartDecision(captures,url,'restart'),{kind:'new',seconds:0});
});
test('continuar regressa 8 segundos antes do último cue',()=>{
 assert.deepEqual(captureStartDecision(captures,url,'resume','cap1'),{kind:'resume',lessonId:'cap1',seconds:22});
 assert.throws(()=>captureStartDecision(captures,url,'resume','other'),/não está disponível/);
});
test('tokens da query não interferem com a identidade da aula',()=>{
 assert.equal(normalizeCaptureUrl(url),'https://play.hotmart.com/aula-123');
 assert.equal(previousCaptures(captures,'https://play.hotmart.com/outro').length,0);
});
test('capturas de merge e superseded não são propostas para retoma',()=>{
 assert.equal(previousCaptures([{...captures[0],supersededBy:'cap2'}],url).length,0);
 assert.equal(previousCaptures([{...captures[0],mergeSources:['a','b']}],url).length,0);
});
