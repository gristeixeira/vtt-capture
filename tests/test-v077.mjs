import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {completionExpression} from '../lib/lesson-ui.js';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const manifest=JSON.parse(read('manifest.json'));

test('versão aparece no topo e coincide com manifest',()=>{
  const html=read('popup.html'), js=read('popup.js');
  assert.equal(manifest.version,'0.8.6');
  assert.match(html,/FHAD VTT Capture <span id="extensionVersion"/);
  assert.match(js,/getManifest\(\)\.version/);
});

test('ícones de gravação vermelho e repouso azul e badge de blocos',()=>{
  const js=read('background.js');
  for(const size of [16,48,128]){
    const a=new URL(`../icons/blue${size}.png`,import.meta.url);
    const b=new URL(`../icons/red${size}.png`,import.meta.url);
    assert.ok(existsSync(a));assert.ok(existsSync(b));
    assert.notDeepEqual(readFileSync(a),readFileSync(b));
  }
  assert.match(js,/updateCaptureIcon\(tabId,Boolean\(s\.tracking/);
  assert.match(js,/s\.tracking\?badgeValue\(count\)/);
});

test('qualidade e velocidade estão recolhidas depois dos botões de download e eventos',()=>{
  const html=read('popup.html');
  assert.equal((html.match(/<details class="panel collapsible">/g)||[]).length,2);
  assert.ok(html.indexOf('id="events"')<html.indexOf('id="speedButtons"'));
  assert.ok(html.indexOf('id="speedButtons"')<html.indexOf('id="qualityMin"'));
  assert.ok(!/<details[^>]*open/.test(html));
  assert.match(read('background.js'),/s\.playbackSpeed=6/);
  assert.match(html,/id="qualityMin"/);
});

test('limpeza no popup tem um único botão e exige confirmação',()=>{
  const html=read('popup.html'), js=read('popup.js'),bg=read('background.js');
  assert.equal((html.match(/id="clear[A-Z][A-Za-z]+"/g)||[]).length,1);
  assert.match(html,/id="clearEligible"/);
  assert.match(js,/confirm\(`Limpar/);
  assert.match(bg,/case 'CLEAR_ELIGIBLE':return clearEligible\(s\)/);
  assert.match(bg,/canClearEmptyLesson\(s,l\)\|\|canClearLesson\(s,l\)\|\|canClearMergedSource\(s,l\)/);
});

function fakeCompletion({pageUrl='https://hotmart.com/aula-1',heading='Módulo 03 - A base do Light Copy',label='Concluir'}={}){
  let clicked=0;
  const title={textContent:heading,getClientRects(){return [1];}};
  const button={textContent:label,innerText:label,disabled:false,getClientRects(){return [1];},getAttribute(){return null;},click(){clicked++;}};
  const doc={querySelectorAll(sel){if(sel==='*')return [];if(sel==='h1.text-2xl,h1[class*="text-2xl"],main h1')return [title];if(sel==='button,[role="button"]')return [button];return [];}};
  return {call:(expectedUrl='https://hotmart.com/aula-1',expectedTitle='Módulo 03 - A base do Light Copy')=>runInNewContext(completionExpression(expectedUrl,expectedTitle),{document:doc,location:{href:pageUrl},getComputedStyle:()=>({visibility:'visible'}),URL}),get clicked(){return clicked;}};
}

test('conclusão exige URL e h1 corretos e aciona apenas o botão Concluir',()=>{
  const ok=fakeCompletion();const result=ok.call();assert.equal(result.clicked,true);assert.equal(ok.clicked,1);
  const wrongUrl=fakeCompletion({pageUrl:'https://hotmart.com/aula-2'});
  assert.equal(wrongUrl.call().ok,false);assert.equal(wrongUrl.clicked,0);
  const wrongHeading=fakeCompletion({heading:'Outra aula'});
  assert.equal(wrongHeading.call().ok,false);assert.equal(wrongHeading.clicked,0);
  const completed=fakeCompletion({label:'Concluída'});
  assert.equal(completed.call().confirmed,true);assert.equal(completed.clicked,0);
});


test('popup identifica tabId antes de obter estado e apresenta diagnóstico da ligação',()=>{
  const js=read('popup.js');
  const stateRequest=js.indexOf("ask({type:'STATE',tabId:activeTabId})");
  assert.ok(stateRequest>0);
  assert.ok(js.lastIndexOf('activeTabId=tabs.find',stateRequest)>0);
  assert.match(read('popup.html'),/id="captureHealth"/);
  assert.match(js,/health.connected/);
  assert.match(read('background.js'),/Runtime.enable/);
});
