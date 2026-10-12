import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../content.js',import.meta.url),'utf8');
function simulate(sendMessage){
  let clock=0,calls=0,disconnected=0,clearedIntervals=0,scanHandler;
  let send=sendMessage;
  const doc={title:'Big Black Friday Infinita | Hotmart',
    querySelectorAll(){return [];},addEventListener(){}};
  const context={document:doc,
    location:{href:'https://hotmart.com/pt-BR/club/demo/products/1/content/aula1'},
    getComputedStyle(){return {visibility:'visible'};},
    MutationObserver:class {observe(){}disconnect(){disconnected++;}},
    chrome:{runtime:{id:'sample-id',onMessage:{addListener(fn){scanHandler=fn;}},
      sendMessage(msg){calls++;return send(msg);}}},
    Date:{now:()=>clock},
    setTimeout(fn,ms){clock+=ms;fn();return 1;},clearTimeout(){},
    setInterval(){return 7;},clearInterval(){clearedIntervals++;},
    window:{addEventListener(){}}
  };
  runInNewContext(source,context);
  return {get calls(){return calls;},get disconnected(){return disconnected;},
    get clearedIntervals(){return clearedIntervals;},scan(){scanHandler?.({type:'SCAN'});}};
}
test('desativa observadores e timer quando sendMessage lança context invalidated sincronicamente',()=>{
  const result=simulate(()=>{throw Error('Extension context invalidated.');});
  assert.equal(result.calls,1);
  assert.equal(result.disconnected,1);
  assert.equal(result.clearedIntervals,1);
  result.scan();
  assert.equal(result.calls,1,'script antigo não volta a comunicar com runtime');
});
test('trata rejeição assíncrona sem gerar exceção global nem insistir em enviar',async()=>{
  const result=simulate(()=>Promise.reject(Error('Extension context invalidated.')));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(result.calls,1);
  assert.equal(result.disconnected,1);
  assert.equal(result.clearedIntervals,1);
  result.scan();
  assert.equal(result.calls,1);
});
