import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../content.js', import.meta.url), 'utf8');

test('identifica o h1 Hotmart mesmo atrás de shadow roots aninhadas', () => {
  const seen = [];
  const heading = {
    textContent:'Módulo 02 - Gatilhos Mentais: Reconhecimento',
    getAttribute(){return null;}, getClientRects(){return [1];}
  };
  const deepest = { querySelectorAll(sel) {
    if (sel==='h1.text-2xl' || sel==='h1[class*="text-2xl"]' || sel==='h1' || sel==='main h1') return [heading];
    return [];
  }};
  const layer = {querySelectorAll(sel){return sel==='*' ? [{shadowRoot:deepest}] : [];}};
  const doc = {title:'Big Black Friday Infinita | Hotmart', documentElement:{},
    querySelectorAll(sel){return sel==='*' ? [{shadowRoot:layer}] : [];},
    addEventListener(){} };
  let virtualTime=0;
  const context = {
    document:doc, location:{href:'https://hotmart.com/pt-BR/club/c/products/1/content/aula1'},
    getComputedStyle:()=>({visibility:'visible'}),
    MutationObserver:class {observe(){}disconnect(){}},
    chrome:{runtime:{id:'test-extension',onMessage:{addListener(fn){context.scan=fn;}},sendMessage(payload){seen.push(payload);return Promise.resolve();}}},
    Date:{now:()=>virtualTime},
    setInterval(){},clearInterval(){},setTimeout(fn,ms){virtualTime+=(ms||0);fn();return 1;},clearTimeout(){},window:{addEventListener(){}}
  };
  runInNewContext(source,context);
  assert.equal(seen.length,1);
  assert.equal(seen[0].meta.title,'Módulo 02 - Gatilhos Mentais: Reconhecimento');
  assert.equal(seen[0].meta.confidence,'alta');
  heading.textContent='Módulo 02 - Gatilhos Mentais: Surpresa';
  context.location.href='https://hotmart.com/pt-BR/club/c/products/1/content/aula2';
  context.scan({type:'SCAN'});
  assert.equal(seen.at(-1).meta.title,'Módulo 02 - Gatilhos Mentais: Surpresa');
  assert.equal(seen.at(-1).meta.url,context.location.href);
});
