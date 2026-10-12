// A resolução de um HTMLVideoElement NÃO pode ser alterada através de uma API
// universal. Só atuamos quando reconhecemos um controlador de qualidade real.
// A alteração do tráfego de rede é intencionalmente proibida: também afetaria VTT.
export function qualityExpression(mode='min') {
  if(!['min','restore'].includes(mode))throw new Error('Modo de qualidade inválido.');
  return `(() => {
    const mode=${JSON.stringify(mode)};
    const videos=[],visited=new Set();
    function visit(root) {
      if (!root || visited.has(root) || typeof root.querySelectorAll!=='function') return;
      visited.add(root);
      for (const video of root.querySelectorAll('video')) videos.push(video);
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) visit(el.shadowRoot);
        if (el.tagName==='IFRAME') { try { visit(el.contentDocument); } catch {} }
      }
    }
    visit(document);
    const v=videos.map(v=>({v,score:(Number.isFinite(v.duration)&&v.duration>0?10:0)+(v.readyState>1?5:0)+(!v.paused?10:0)}))
      .sort((a,b)=>b.score-a.score)[0]?.v;
    if(!v)return {found:false,status:'Player ainda não acessível'};
    const observedHeight=Number(v.videoHeight)||0;
    const symbol=Symbol.for('fhad.vtt.qualityBackups');
    const backups=globalThis[symbol]||(globalThis[symbol]=new WeakMap());
    const saved=backups.get(v);
    function restore() {
      if(!saved)return {found:true,applied:false,restored:true,observedHeight,status:'Qualidade não alterada pela extensão'};
      try {
        if(saved.provider==='hls.js') {
          const hls=saved.controller;
          if(hls&&typeof hls.currentLevel==='number') hls.currentLevel=saved.previous;
        } else if(saved.provider==='video.js') {
          const levels=saved.controller;
          for(let i=0;i<saved.previous.length;i++) {
            if(levels[i])levels[i].enabled=saved.previous[i];
          }
        } else if(saved.provider==='jwplayer') {
          const jw=saved.controller;
          if(jw&&typeof jw.setCurrentQuality==='function'&&Number.isInteger(saved.previous))jw.setCurrentQuality(saved.previous);
        }
        backups.delete(v);
        return {found:true,applied:false,restored:true,observedHeight,status:'Qualidade anterior reposta'};
      }catch(e){return {found:true,applied:false,restored:false,observedHeight,status:'Não foi possível repor a qualidade anterior'};}
    }
    if(mode==='restore')return restore();
    if(saved)return {found:true,applied:true,provider:saved.provider,height:saved.height,
      observedHeight,status:'Qualidade mínima solicitada: '+saved.height+'p ('+saved.provider+')'};
    function lowest(levels){
      const options=Array.from(levels||[]).map((x,i)=>({i,height:Number(x?.height)||0,bitrate:Number(x?.bitrate||x?.bandwidth)||0}))
        .filter(x=>x.height>0 || x.bitrate>0);
      options.sort((a,b)=>(a.height||1e9)-(b.height||1e9)||(a.bitrate||1e12)-(b.bitrate||1e12));
      return options[0]||null;
    }
    // hls.js quando a instância é disponibilizada pelo player.
    const hlsCandidates=[v.hls,v._hls,v.hlsjs,v._hlsjs,globalThis.hls,globalThis.hlsInstance];
    for(const hls of hlsCandidates){
      if(!hls || !Array.isArray(hls.levels) || !('currentLevel' in hls))continue;
      if(hls.media && hls.media!==v)continue;
      const chosen=lowest(hls.levels);
      if(!chosen)continue;
      try {
        const previous=Number(hls.currentLevel);
        hls.currentLevel=chosen.i;
        if(Number(hls.currentLevel)!==chosen.i)continue;
        backups.set(v,{provider:'hls.js',controller:hls,previous,height:chosen.height||'?'});
        return {found:true,applied:true,provider:'hls.js',height:chosen.height,
          observedHeight,status:'Qualidade mínima solicitada: '+(chosen.height||'?')+'p (hls.js)'};
      } catch {}
    }
    // Video.js + qualityLevels: disponibiliza a seleção das representações HLS.
    const videojs=globalThis.videojs;
    if(typeof videojs==='function'){
      let player=null;
      try{
        if(v.id && typeof videojs.getPlayer==='function')player=videojs.getPlayer(v.id);
        if(!player && typeof videojs.getPlayers==='function'){
          for(const p of Object.values(videojs.getPlayers()||{})){
            if(p && typeof p.el==='function' && p.el()?.contains?.(v)){player=p;break;}
          }
        }
      }catch{}
      if(player && typeof player.qualityLevels==='function'){
        try {
          const levels=player.qualityLevels();
          const chosen=lowest(Array.from({length:levels.length||0},(_,i)=>levels[i]));
          if(chosen){
            const previous=Array.from({length:levels.length},(_,i)=>Boolean(levels[i].enabled));
            for(let i=0;i<levels.length;i++)levels[i].enabled=i===chosen.i;
            if(Boolean(levels[chosen.i].enabled)){
              backups.set(v,{provider:'video.js',controller:levels,previous,height:chosen.height||'?'});
              return {found:true,applied:true,provider:'video.js',height:chosen.height,
                observedHeight,status:'Qualidade mínima solicitada: '+(chosen.height||'?')+'p (video.js)'};
            }
            for(let i=0;i<levels.length;i++)levels[i].enabled=previous[i];
          }
        }catch{}
      }
    }
    // JW Player: controlador público de qualidade, quando o embed o disponibiliza.
    const jwFactory=globalThis.jwplayer;
    if(typeof jwFactory==='function') {
      try {
        const candidates=[];
        if(typeof jwFactory.getAllPlayers==='function')candidates.push(...jwFactory.getAllPlayers());
        else if(typeof jwFactory.getPlayers==='function')candidates.push(...Object.values(jwFactory.getPlayers()||{}));
        if(!candidates.length)candidates.push(jwFactory());
        for(const jw of candidates) {
          if(!jw || typeof jw.getQualityLevels!=='function' || typeof jw.setCurrentQuality!=='function')continue;
          if(typeof jw.getContainer==='function'){
            const container=jw.getContainer();
            if(container && container!==v && !container.contains?.(v))continue;
          }
          const levels=jw.getQualityLevels()||[];
          const ranked=Array.from(levels).map((x,i)=>({i,height:Number(x?.height)||Number.parseInt(x?.label)||0,bitrate:Number(x?.bitrate)||0}))
            .filter(x=>x.height>0 || x.bitrate>0).sort((a,b)=>(a.height||1e9)-(b.height||1e9)||(a.bitrate||1e12)-(b.bitrate||1e12));
          const chosen=ranked[0];if(!chosen)continue;
          const previous=typeof jw.getCurrentQuality==='function'?Number(jw.getCurrentQuality()):null;
          jw.setCurrentQuality(chosen.i);
          const actual=typeof jw.getCurrentQuality==='function'?Number(jw.getCurrentQuality()):chosen.i;
          if(actual!==chosen.i)continue;
          backups.set(v,{provider:'jwplayer',controller:jw,previous,height:chosen.height||'?'});
          return {found:true,applied:true,provider:'jwplayer',height:chosen.height,observedHeight,
            status:'Qualidade mínima solicitada: '+(chosen.height||'?')+'p (JW Player)'};
        }
      }catch{}
    }
    return {found:true,applied:false,unsupported:true,observedHeight,
      status:'Qualidade não alterada: o player não disponibiliza uma API de controlo compatível. Escolhe a resolução mínima no menu do vídeo.'};
  })()`;
}
