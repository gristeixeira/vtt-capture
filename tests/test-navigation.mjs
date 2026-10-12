import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../lib/navigation.js',import.meta.url),'utf8');
const rect=(x,y,w=35,h=32)=>({x,y,width:w,height:h,top:y,left:x,right:x+w,bottom:y+h});
function el(x,y,label=''){
  return {clicked:false,disabled:false,getBoundingClientRect(){return rect(x,y)},getAttribute(attr){return attr==='aria-label'?label:null;},click(){this.clicked=true;},textContent:''};
}
function run(buttons){
  const h1={getBoundingClientRect(){return rect(260,215,750,40)},closest(){return null},parentElement:{parentElement:{}}};
  const doc={querySelectorAll(sel){if(sel==='*')return [];if(sel.startsWith('h1'))return [h1];if(sel.startsWith('button'))return buttons;return [];}};
  const ctx={document:doc,globalThis:null};ctx.globalThis=ctx;
  runInNewContext(source,ctx);return ctx.fhadFindNextLesson();
}
test('botão Próxima aula identificado por rótulo ganha prioridade',()=>{
  const previous=el(950,160,'Anterior');const next=el(995,160,'Próxima aula');
  const result=run([previous,next]);assert.equal(result.ok,true);result.element.click();
  assert.equal(previous.clicked,false);assert.equal(next.clicked,true);
});
test('par de botões de navegação sem rótulo escolhe o da direita',()=>{
  const previous=el(950,160);const next=el(995,160);
  const result=run([previous,next]);assert.equal(result.ok,true);assert.equal(result.element,next);
});
test('não avança se o controlo não for identificado de forma segura',()=>{
  const result=run([el(995,160)]);assert.equal(result.ok,false);
});
