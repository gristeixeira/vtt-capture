import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeCues,sameLesson} from '../lib/merge.js';

const cue=(start,end,text)=>({start,end,text,raw:text});
test('deduplicação do merge tolera diferenças pequenas de tempo e pontuação',()=>{
  const a={cues:[cue(1000,1600,'Olá!'),cue(1800,2500,'Vamos começar.'),cue(4000,4500,'Sim')]};
  const b={cues:[cue(1100,1650,'olá'),cue(1800,2500,'Vamos começar.'),cue(8200,8500,'Sim')]};
  const result=mergeCues([a,b]);
  assert.equal(result.inputCount,6);
  assert.equal(result.removed,2);
  assert.equal(result.cues.length,4);
  assert.deepEqual(result.cues.map(c=>c.start),[1000,1800,4000,8200]);
});
test('preserva falas iguais em momentos diferentes e nunca confunde outra aula',()=>{
  const result=mergeCues([{cues:[cue(1000,1500,'Sim'),cue(3000,3500,'Sim')]}]);
  assert.equal(result.removed,0);
  assert.equal(sameLesson({title:'Aula',pageUrl:'https://hotmart.com/lesson1'},
    {title:'aula',pageUrl:'https://hotmart.com/lesson2'}),false);
  assert.equal(sameLesson({title:'Aula',pageUrl:'https://hotmart.com/lesson1',course:'Hotmart'},
    {title:' aula ',pageUrl:'https://hotmart.com/lesson1',course:'LightCopy'}),true);
});
