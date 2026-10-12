"""Testes reais da UI do popup via Chromium/Playwright. Executar: python tests/test-popup-v081.py"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
MOCK_STATE={
 'tracking':False,'tabId':100,'currentId':None,
 'lessons':[
  {'id':'l1','title':'Módulo 03 - Aula 01','pageUrl':'https://hotmart.com/a','course':'LightCopy',
   'segments':12,'cueCount':20,'endedAt':'2026-10-12T12:00:00.000Z','confidence':'alta'},
  {'id':'l2','title':'Módulo 03 - Aula 02','pageUrl':'https://hotmart.com/b','course':'LightCopy',
   'segments':14,'cueCount':31,'endedAt':'2026-10-12T13:00:00.000Z','confidence':'alta'},
  {'id':'l3','title':'Módulo 03 - Aula 03','pageUrl':'https://hotmart.com/c','course':'LightCopy',
   'segments':0,'cueCount':0,'endedAt':'2026-10-12T14:00:00.000Z','confidence':'baixa'},
 ],
 'playbackSpeed':6,'sessionHealth':{'connected':False},'log':[],
 'qualityMinOnCapture':True,'autoRecover':True
}

def init_mock(state):
 return '''(() => {
  const state = '''+json.dumps(state,ensure_ascii=False)+''';
  window.__requests=[];
  Object.assign(window.chrome, {
    runtime: {
      getManifest:()=>({version:'0.8.1'}),
      sendMessage:async msg=>{
        window.__requests.push(msg);
        if(msg.type==='STATE')return {ok:true,state:JSON.parse(JSON.stringify(state))};
        if(msg.type==='EXPORT_SELECTED')return {ok:true,count:msg.lessonIds.length};
        if(msg.type==='EXPORT_ALL')return {ok:true,count:state.lessons.length};
        return {ok:true};
      },
      onMessage:{addListener:()=>{}}
    },
    tabs:{query:async()=>[{id:100,url:'https://hotmart.com/a'}]}
  });
 })();'''

def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':500,'height':1000})
  # O mock é instalado após carregar o HTML, antes do JavaScript do popup.
  # O ambiente bloqueia navegações HTTP locais. O popup funciona também
  # injetado em about:blank, com a API da extensão simulada.
  html=(ROOT/'popup.html').read_text().replace('<script type="module" src="popup.js"></script>','')
  html=html.replace('<link rel="stylesheet" href="popup.css">','<style>'+ (ROOT/'popup.css').read_text()+'</style>')
  page.goto('about:blank')
  page.set_content(html)
  page.evaluate(init_mock(MOCK_STATE))
  page.add_script_tag(content=(ROOT/'popup.js').read_text())
  page.wait_for_function('document.querySelectorAll("input[data-merge]").length===3')
  # 0 selecionadas: download todas; nenhum download sem clique
  assert page.locator('#exportLessons').inner_text()=='↓ Descarregar todas as aulas (2)'
  assert page.locator('#selectAll').is_checked() is False
  assert page.evaluate('document.querySelector(".current-lesson").open') is False
  assert page.evaluate('document.querySelector(".supervisor-panel").open') is False
  assert page.locator('#currentLessonSummary').inner_text()=='Aguardando aula…'
  assert page.evaluate('document.querySelectorAll("#exportLessons").length')==1
  assert page.evaluate('document.querySelector(".supervisor-panel").compareDocumentPosition(document.querySelector("footer")) & Node.DOCUMENT_POSITION_FOLLOWING') !=0
  assert page.evaluate('document.querySelector(".supervisor-panel").compareDocumentPosition(document.querySelector("#qualityMin")) & Node.DOCUMENT_POSITION_PRECEDING') !=0
  page.locator('#exportLessons').click()
  assert page.evaluate('window.__requests.filter(x=>x.type.startsWith("EXPORT")).at(-1).type')=='EXPORT_ALL'
  # seleção parcial: um único ZIP apenas com l1
  page.locator('input[data-merge="l1"]').check()
  assert page.locator('#selectAll').is_checked() is False
  assert page.evaluate('document.getElementById("selectAll").indeterminate') is True
  assert page.locator('#exportLessons').inner_text()=='↓ Descarregar aulas selecionadas (1)'
  page.locator('#exportLessons').click()
  last=page.evaluate('window.__requests.filter(x=>x.type.startsWith("EXPORT")).at(-1)')
  assert last=={'type':'EXPORT_SELECTED','lessonIds':['l1']},last
  # checkbox geral com seleção parcial passa a selecionar todos os exportáveis
  page.locator('#selectAll').check()
  assert page.locator('input[data-merge="l1"]').is_checked()
  assert page.locator('input[data-merge="l2"]').is_checked()
  assert page.locator('input[data-merge="l3"]').is_disabled()
  assert page.locator('#selectAll').is_checked()
  page.locator('#exportLessons').click()
  last=page.evaluate('window.__requests.filter(x=>x.type.startsWith("EXPORT")).at(-1)')
  assert last=={'type':'EXPORT_SELECTED','lessonIds':['l1','l2']},last
  # desmarcar todos via checkbox geral
  page.locator('#selectAll').uncheck()
  assert not page.locator('input[data-merge="l1"]').is_checked()
  assert not page.locator('input[data-merge="l2"]').is_checked()
  assert page.locator('#exportLessons').inner_text()=='↓ Descarregar todas as aulas (2)'
  # título visível no resumo mesmo recolhido
  page.evaluate('''() => {const el=document.querySelector('#currentLessonSummary');el.textContent='Módulo 03 - A base do Light Copy';}''')
  assert page.locator('#currentLessonSummary').is_visible()
  # screenshot para inspecionar a apresentação
  page.screenshot(path=str(ROOT/'tests'/'popup-v081-preview.png'),full_page=True)
  browser.close()
 print('OK: download contextual, seleção parcial/todas/nenhuma, painéis recolhidos e posição do supervisor')

if __name__=='__main__':run()
