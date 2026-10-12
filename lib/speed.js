// Velocidades suportadas. Não confundir a seleção do utilizador com a
// velocidade realmente aceite pelo fornecedor de vídeo.
export const SPEEDS=Object.freeze([1,2,3,4,6]);
export function checkedSpeed(value){
  const rate=Number(value);
  if(!SPEEDS.includes(rate))throw Error('Velocidade inválida. Escolhe 1×, 2×, 3×, 4× ou 6×.');
  return rate;
}
export const speedLabel=value=>`${Number(value)}×`;
export const matchesSpeed=(actual,desired)=>Number.isFinite(actual) && Math.abs(actual-desired)<0.06;

// Executado via Runtime.evaluate *no contexto do frame que contém o player*.
// Seleciona o vídeo com o mesmo critério da sonda de progresso; nunca clica
// em controlos da Hotmart nem procura streams fora do separador do utilizador.
export function speedExpression(speed){
  const rate=checkedSpeed(speed);
  return `(() => {
    const videos=[], seen=new Set();
    function visit(root){
      if(!root||seen.has(root))return;seen.add(root);
      for(const v of root.querySelectorAll('video'))videos.push(v);
      for(const el of root.querySelectorAll('*')){
        if(el.shadowRoot)visit(el.shadowRoot);
        if(el.tagName==='IFRAME'){try{visit(el.contentDocument)}catch{}}
      }
    }
    visit(document);
    const v=videos.map(x=>({v:x,score:(x.duration&&isFinite(x.duration)?10:0)+(x.readyState>1?5:0)+(!x.paused?10:0)}))
      .sort((a,b)=>b.score-a.score)[0]?.v;
    if(!v)return {found:false};
    try{
      v.playbackRate=${rate};
      try{v.defaultPlaybackRate=${rate}}catch{}
      return {found:true,rate:Number(v.playbackRate)};
    }catch(e){return {found:true,error:String(e?.message||e).slice(0,120)}}
  })()`;
}
