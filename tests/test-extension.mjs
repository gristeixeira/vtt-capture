import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {parseVtt,isVttCandidate,slug,exportFormats} from '../lib/vtt.js';
import {createZip,binaryBase64} from '../lib/zip.js';

test('identifica WEBVTT e obtém cues por tempo',()=>{
  const sample=`WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:900000,LOCAL:00:00:00.000\n\n936444474\n00:03:30.400 --> 00:03:31.850\nE eu perguntei, por que?\n\n3942279420\n00:03:32.000 --> 00:03:33.710\nEla falou, a mulher cozinhou para mim por\n`;
  const result=parseVtt(sample);
  assert.equal(result.valid,true);
  assert.equal(result.cues.length,2);
  assert.equal(result.cues[0].start,210400);
  assert.equal(result.map.mpegts,'900000');
  assert.match(result.cues[1].text,/mulher cozinhou/);
});
test('descarta blocos inválidos e limpa marcação',()=>{
  const data='WEBVTT\n\nSTYLE\n::cue { color: white; }\n\nNOTE teste\nTeste\n\n00:01.000 --> 00:02.000\n<v Ana>Olá &amp; adeus</v>\n';
  const parsed=parseVtt(data);
  assert.equal(parsed.cues.length,1);assert.equal(parsed.cues[0].text,'Olá & adeus');
  assert.equal(parseVtt('outro texto').valid,false);
});
test('segredos da URL não são colocados no slug e detecta URL VTT',()=>{
  assert.equal(slug('../../segredos:token?abc'),'segredos-token-abc');
  assert.ok(isVttCandidate('https://exemplo.net/x/legenda.vtt?token=secret','application/octet-stream'));
  assert.ok(isVttCandidate('https://exemplo.net/subtitles?id=1','text/plain'));
  assert.equal(isVttCandidate('https://exemplo.net/seg1.ts','video/mp2t'),false);
});
test('gera VTT, TXT, Markdown e JSON da aula',()=>{
  const lesson={id:'lesson-1',title:'Aula 1',course:'LightCopy',pageUrl:'https://play.hotmart.com/course/aula',
    startedAt:'2026-10-11T20:00:00.000Z',endedAt:'2026-10-11T20:15:00.000Z',confidence:'alta',segments:3,
    cues:[{start:1000,end:2000,text:'Olá',raw:'Olá'},{start:1000,end:2000,text:'Olá',raw:'Olá'},
      {start:2000,end:3000,text:'mundo',raw:'mundo'}]};
  const out=exportFormats(lesson);
  assert.match(out.vtt,/00:00:01.000 --> 00:00:02.000/);
  assert.deepEqual(out.txt.trim().split('\n'),['Olá','mundo']);
  assert.match(out.md,/## Transcrição/);
  assert.equal(JSON.parse(out.json).uniqueCues,2);
});
test('cria ZIP válido para o extrator ZIP do sistema',()=>{
  const file=createZip({'aula/transcricao.txt':'Olá!\n','aula/meta.json':'{"x":1}\n'});
  assert.equal(file[0],0x50);assert.equal(binaryBase64(file),Buffer.from(file).toString('base64'));
  writeFileSync(new URL('./sample.zip', import.meta.url),file);
});
