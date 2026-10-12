"""Browser integration: quality option's center swallows click, text area succeeds."""
from pathlib import Path
import subprocess,tempfile
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
def expr(mode):
  script="import {qualityMenuExpression} from '"+(ROOT/'lib/quality-menu.js').as_uri()+"';console.log(qualityMenuExpression('"+mode+"',true))"
  with tempfile.NamedTemporaryFile('w',suffix='.mjs',dir=ROOT,delete=False) as f:
    f.write(script);p=Path(f.name)
  try:return subprocess.check_output(['node',str(p)],text=True).strip()
  finally:p.unlink(missing_ok=True)

INNER='''<!doctype html><html><head><style>
body{margin:0}video{position:absolute;left:10px;top:10px;width:745px;height:425px;background:#111}
button{cursor:pointer} #settings{position:absolute;top:375px;left:680px}
#settingsmenu{position:absolute;top:270px;left:550px;display:none}
#qualitymenu{position:absolute;top:180px;left:550px;display:none}
#qualitymenu button{position:relative;display:block;width:150px;height:34px}
#absorber{position:absolute;left:45px;top:0;width:100px;height:34px;background:transparent}
</style></head><body>
<video></video>
<button id="settings" aria-label="Configurações">⚙</button>
<div id="settingsmenu"><button id="qr">Qualidade Auto</button><button>Velocidade 1x</button></div>
<div id="qualitymenu"><button id="auto">Auto</button><button id="quality240">240p<span id="absorber"></span></button><button>360p</button></div>
<div id="sel"></div>
<script>
document.querySelector('#settings').onclick=()=>document.querySelector('#settingsmenu').style.display='block';
document.querySelector('#qr').onclick=()=>document.querySelector('#qualitymenu').style.display='block';
document.querySelector('#absorber').onclick=e=>{e.stopPropagation();window.blockedClick=e.isTrusted;};
document.querySelector('#quality240').onclick=e=>{
  window.lastTrusted=e.isTrusted;
  document.querySelector('#sel').textContent='240p';
  document.querySelector('#qr').textContent='Qualidade 240p';
  document.querySelector('#qualitymenu').style.display='none';
};
</script></body></html>'''
with sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  ctx=browser.new_context(viewport={'width':1200,'height':800})
  page=ctx.new_page();page.set_content('<style>body{margin:0}iframe{position:absolute;left:127px;top:83px;width:800px;height:540px;border:0}</style><iframe id="player"></iframe>')
  page.evaluate("html => document.querySelector('#player').srcdoc=html",INNER)
  page.frame_locator('#player').locator('#settings').wait_for()
  cdp=ctx.new_cdp_session(page)
  def evaluate(mode):return cdp.send('Runtime.evaluate',{'expression':expr(mode),'returnByValue':True,'awaitPromise':True,'userGesture':True})['result']['value']
  def click(pos):
    for typ,buttons in (('mouseMoved',0),('mousePressed',1),('mouseReleased',0)):
      cdp.send('Input.dispatchMouseEvent',{'type':typ,'button':'left','buttons':buttons,'x':pos['x'],'y':pos['y'],'clickCount':1})
  a=evaluate('target');assert a['ready'],a
  click(a)
  b=evaluate('verify');assert not b['applied'],b
  alt=evaluate('retry-target');assert alt['ready'] and alt['height']==240,alt
  assert abs(a['x']-alt['x'])>=8,(a,alt)
  click(alt)
  after=evaluate('verify');assert after['applied'],after
  assert page.frame_locator('#player').locator('#sel').inner_text()=='240p'
  assert page.frame_locator('#player').locator('#sel').evaluate('(el)=>el.ownerDocument.defaultView.lastTrusted') is True
  print('OK: first trusted click intercepted, alternative trusted click confirmed 240p',a['x'],alt['x'])
  browser.close()
