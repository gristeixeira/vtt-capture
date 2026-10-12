import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {qualityMenuExpression} from '../lib/quality-menu.js';

function fakeHotmart({heights=[1080,480,240,144],startOpen=false,hasSettings=true,acceptChange=true,captionControl=false,captionOpenAtStart=false,frameOffset=null}={}) {
  let settingsOpen=startOpen,qualityOpen=false,captionsOpen=captionOpenAtStart,captionClicks=0,settingsClicks=0,selected='Auto',selectedClicks=0;
  const box=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height,width,height});
  const video={paused:false,duration:800,readyState:4,videoHeight:720,getBoundingClientRect:()=>box(100,100,750,430)};
  const el=(text,attr={},onClick=()=>{},tag='BUTTON')=>({
    tagName:tag,innerText:text,textContent:text,className:'',getAttribute:k=>attr[k]||'',
    getBoundingClientRect:()=>box(650,440,110,30),
    matches:q=>q.includes('button')&&tag==='BUTTON', click:onClick
  });
  const settings=el('',{'aria-label':'Configurações'},()=>{settingsClicks++;settingsOpen=true;});
  const captions=el('',{'aria-label':'Legendas'},()=>{captionClicks++;captionsOpen=true;});
  captions.className='player-settings-controls';
  const capLabel=el('Legendas'),lang=el('Idioma Português (Brasil)'),style=el('Estilo');
  const quality=el('Qualidade Auto',{},()=>{qualityOpen=true;});
  const speed=el('Velocidade 1x');
  const opts=heights.map(h=>el(`${h}p`,{},()=>{selectedClicks++;qualityOpen=false;if(acceptChange){selected=h;quality.innerText='Qualidade '+h+'p';quality.textContent=quality.innerText;}}));
  const auto=el('Auto',{},()=>{selected='Auto';qualityOpen=false;quality.innerText='Qualidade Auto';quality.textContent=quality.innerText;});
  const doc={querySelectorAll(selector){
    if(selector==='video')return [video];
    if(selector==='*')return [];
    const list=[];
    if(captionControl)list.push(captions);
    if(hasSettings)list.push(settings);
    if(captionsOpen)list.push(capLabel,lang,style);
    if(settingsOpen)list.push(quality,speed);
    if(qualityOpen)list.push(auto,...opts);
    return list;
  }};
  const scope={document:doc,globalThis:null,Symbol,WeakMap,Set,Number,Array,Map,Promise,setTimeout,getComputedStyle:()=>({display:'block',visibility:'visible',opacity:'1'})};
  scope.globalThis=scope;
  if(frameOffset){
    const parent={};parent.parent=parent;
    scope.window={parent,frameElement:{getBoundingClientRect:()=>box(frameOffset.left,frameOffset.top,200,150)}};
  }
  return {evaluate:(mode,relativeToTab=false)=>vm.runInNewContext(qualityMenuExpression(mode,relativeToTab),scope),applyTrustedSelection(value){selected=value;quality.innerText='Qualidade '+value+'p';quality.textContent=quality.innerText;qualityOpen=false;},get selected(){return selected;},get clicks(){return selectedClicks;},get captionClicks(){return captionClicks;},get settingsClicks(){return settingsClicks;},closeCaptions(){captionsOpen=false;},openSettings(){settingsOpen=true;}};
}

test('Hotmart menu seleciona resolução mais baixa e repõe Auto',async()=>{
  const player=fakeHotmart();
  const r=await player.evaluate('min');
  assert.equal(r.applied,true);
  assert.equal(r.height,144);
  assert.equal(r.provider,'Hotmart Player (menu)');
  assert.equal(player.selected,144);
  assert.equal((await player.evaluate('min')).applied,true);
  assert.equal(player.clicks,1,'não muda a qualidade repetidamente');
  const restore=await player.evaluate('restore');
  assert.equal(restore.restored,true);
  assert.equal(player.selected,'Auto');
});

test('resolução mínima pode ser 360p e indica que 240p não está disponível',async()=>{
  const p=fakeHotmart({heights:[1080,480,360]});
  const r=await p.evaluate('min');
  assert.equal(r.height,360);
  assert.match(r.status,/não existe opção de 240p/);
});

test('não clica no vídeo quando não encontra o botão de configurações',async()=>{
  const p=fakeHotmart({hasSettings:false});
  const r=await p.evaluate('min');
  assert.equal(r.applied,false);
  assert.equal(p.clicks,0);
  assert.match(r.status,/define a qualidade manualmente/i);
});

test('não altera rede, vídeos ou WEBVTT',()=>{
  const src=qualityMenuExpression('min');
  assert.doesNotMatch(src,/Network\.emulateNetworkConditions|fetch\(|XMLHttpRequest|\.src\s*=|\.playbackRate\s*=/);
  assert.throws(()=>qualityMenuExpression('fetch'));
});

test('seleciona 240p quando é a menor resolução disponível',async()=>{
  const player=fakeHotmart({heights:[1080,720,480,360,240]});
  const result=await player.evaluate('min');
  assert.equal(result.height,240);
  assert.equal(result.applied,true);
  assert.equal(player.selected,240);
});

test('não declara qualidade aplicada quando o menu ignora o clique',async()=>{
  const player=fakeHotmart({heights:[1080,720,240],acceptChange:false});
  const result=await player.evaluate('min');
  assert.equal(result.requested,true);
  assert.equal(result.applied,false);
  assert.match(result.status,/ainda não confirmou/i);
});


test('regressão: controlo das legendas com className settings não é confundido com engrenagem',async()=>{
  const p=fakeHotmart({captionControl:true});
  const result=await p.evaluate('min');
  assert.equal(result.applied,true);
  assert.equal(p.selected,144);
  assert.equal(p.captionClicks,0,'não deve abrir o submenu Legendas');
  assert.equal(p.settingsClicks,1,'deve abrir o menu de Configurações');
});

test('regressão: se só existem controles de legendas não abre esse submenu nem repete cliques',async()=>{
  const p=fakeHotmart({captionControl:true,hasSettings:false});
  const first=await p.evaluate('min');
  const second=await p.evaluate('min');
  assert.equal(first.applied,false);
  assert.equal(first.doNotRetry,true);
  assert.equal(second.doNotRetry,true);
  assert.equal(p.captionClicks,0);
});

test('regressão: se o submenu Legendas já está aberto, não clica noutras opções',async()=>{
  const p=fakeHotmart({captionControl:true,captionOpenAtStart:true});
  const result=await p.evaluate('min');
  assert.equal(result.applied,false);
  assert.match(result.status,/submenu Legendas/i);
  assert.equal(p.captionClicks,0);
  assert.equal(p.settingsClicks,0);
});

test('pode recuperar após falha se a pessoa abrir manualmente Configurações',async()=>{
  const p=fakeHotmart({hasSettings:false});
  const first=await p.evaluate('min');
  assert.equal(first.applied,false);
  p.openSettings();
  const result=await p.evaluate('min');
  assert.equal(result.applied,true);
  assert.equal(result.height,144);
});


test('CDP: identifica 240p e devolve coordenadas sem disparar clique sintético',async()=>{
  const p=fakeHotmart({heights:[1080,720,360,240],acceptChange:false,startOpen:true});
  const target=await p.evaluate('target');
  assert.equal(target.ready,true);
  assert.equal(target.height,240);
  assert.equal(target.x,705);
  assert.equal(target.y,455);
  assert.equal(p.selected,'Auto');
  assert.equal(p.clicks,0,'a preparação não pode selecionar outra qualidade');
  const unconfirmed=await p.evaluate('verify');
  assert.equal(unconfirmed.applied,false,'sem evento de utilizador Auto permanece ativo');
  p.applyTrustedSelection(240);
  const confirmed=await p.evaluate('verify');
  assert.equal(confirmed.applied,true);
  assert.equal(confirmed.height,240);
  assert.match(confirmed.status,/confirmada/);
});

test('CDP: sem lista de resoluções, nunca inventa coordenadas',async()=>{
  const p=fakeHotmart({hasSettings:false,heights:[240]});
  const target=await p.evaluate('target');
  assert.equal(target.ready,false);
  assert.equal(target.x,undefined);
  assert.equal(p.clicks,0);
});


test('CDP: corrige coordenadas quando o player está num iframe do tab principal',async()=>{
  const p=fakeHotmart({heights:[240,360],frameOffset:{left:130,top:60},startOpen:true});
  const result=await p.evaluate('target',true);
  assert.equal(result.ready,true);
  assert.equal(result.x,835);
  assert.equal(result.y,515);
});


test('CDP: segundo alvo na área do texto 240p apenas após tentativa não confirmada',async()=>{
  const p=fakeHotmart({heights:[360,240],acceptChange:false,startOpen:true});
  const notReady=await p.evaluate('retry-target');
  assert.equal(notReady.ready,false,'não pode repetir clique sem tentativa anterior');
  const first=await p.evaluate('target');
  assert.equal(first.height,240);
  assert.equal(first.x,705);
  const alt=await p.evaluate('retry-target');
  assert.equal(alt.ready,true);
  assert.equal(alt.height,240);
  assert.notEqual(alt.x,first.x);
  assert.equal(p.selected,'Auto','a localização não pode selecionar a qualidade');
});
