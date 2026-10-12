"""Integração Chromium real: iframe, menu DOM e clique CDP trusted (simulação, não Hotmart)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, subprocess
ROOT=Path(__file__).resolve().parents[1]

def expression():
  script="import {qualityMenuExpression} from '" + (ROOT/'lib/quality-menu.js').as_uri() + "'; console.log(qualityMenuExpression('target',true))"
  # ESM no Node com ficheiro temporário dentro da pasta do projeto
  import tempfile
  with tempfile.NamedTemporaryFile('w',suffix='.mjs',dir=ROOT,delete=False) as f:
   f.write(script); path=Path(f.name)
  try:
   return subprocess.check_output(['node',str(path)],text=True).strip()
  finally:
   path.unlink(missing_ok=True)

HTML='''<!doctype html><html><head><style>
body {margin:0;background:#eee} iframe {position:absolute;top:83px;left:127px;width:800px;height:540px;border:0}
</style></head><body><iframe id="player"></iframe></body></html>'''
INNER='''<!doctype html><html><head><style>
body{margin:0} video{position:absolute;left:10px;top:10px;width:745px;height:425px;background:#111}
button{cursor:pointer} #settings{position:absolute;top:375px;left:680px}
#settingsmenu{position:absolute;top:270px;left:550px;display:none}
#qualitymenu{position:absolute;top:180px;left:550px;display:none}
#qualitymenu button{display:block;width:150px;height:34px}
</style></head><body>
<video></video>
<button id="settings" aria-label="Configurações">⚙</button>
<div id="settingsmenu"><button id="qr">Qualidade Auto</button><button>Velocidade 1x</button></div>
<div id="qualitymenu"><button id="auto">Auto</button><button id="quality240">240p</button><button>360p</button></div>
<div id="sel"></div>
<script>
 document.querySelector('#settings').onclick=()=>document.querySelector('#settingsmenu').style.display='block';
 document.querySelector('#qr').onclick=()=>document.querySelector('#qualitymenu').style.display='block';
 document.querySelector('#quality240').onclick=e=>{
   window.lastTrusted=e.isTrusted;
   document.querySelector('#sel').textContent='240p';
   document.querySelector('#qr').textContent='Qualidade 240p';
   document.querySelector('#qualitymenu').style.display='none';
 };
</script></body></html>'''

def main():
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  context=browser.new_context(viewport={'width':1200,'height':800})
  page=context.new_page();page.goto('about:blank');page.set_content(HTML)
  page.evaluate('''html => document.getElementById('player').srcdoc=html''',INNER)
  page.frame_locator('#player').locator('#settings').wait_for()
  cdp=context.new_cdp_session(page)
  result=cdp.send('Runtime.evaluate',{'expression':expression(),'returnByValue':True,'awaitPromise':True,'userGesture':True})['result']['value']
  print('CDP target:',result)
  assert result['ready'] is True,result
  assert result['height']==240,result
  pointer={'x':result['x'],'y':result['y'],'button':'left','clickCount':1}
  print('DOM target:',page.evaluate('''() => ({outer: document.elementFromPoint(752,314)?.outerHTML, inner: document.getElementById('player').contentDocument.elementFromPoint(625,231)?.outerHTML, iframe:document.getElementById('player').getBoundingClientRect().toJSON()})'''))
  for kind,buttons in [('mouseMoved',0),('mousePressed',1),('mouseReleased',0)]:
   cdp.send('Input.dispatchMouseEvent',{'type':kind,'buttons':buttons,**pointer})
  frame=page.frame_locator('#player')
  print('selected:',frame.locator('#sel').inner_text())
  print('last trusted:',frame.locator('#sel').evaluate('(n)=>n.ownerDocument.defaultView.lastTrusted'))
  page.screenshot(path=str(ROOT/'tests'/'trusted-quality-preview.png'))
  assert frame.locator('#sel').inner_text()=='240p','não selecionou opção 240p'
  assert frame.locator('#settingsmenu #qr').inner_text()=='Qualidade 240p'
  assert frame.locator('#sel').evaluate('(node)=>node.ownerDocument.defaultView.lastTrusted') is True
  print('OK: iframe real e clique trusted selecionaram 240p')
  browser.close()

if __name__=='__main__':main()
