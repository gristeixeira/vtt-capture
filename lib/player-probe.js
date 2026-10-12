// A Chrome debugger session is scoped to a renderer target. Cross-origin
// iframes may be separate targets (OOPIF), or share the target with their own
// execution contexts. Enumerate both paths, without modifying the player.
export function frameIds(tree, limit=16) {
  const ids=[];
  const visit=node=>{
    if(!node || ids.length>=limit)return;
    if(typeof node.frame?.id==='string' && node.frame.id)ids.push(node.frame.id);
    for(const child of node.childFrames||[])visit(child);
  };
  visit(tree);
  return [...new Set(ids)];
}

export function validProbe(value) {
  return value && Number.isFinite(value.currentTime) && value.currentTime>=0 &&
    typeof value.paused==='boolean' && typeof value.ended==='boolean';
}

export function rankedProbe(value) {
  return {...value,score:(value.duration>0?10:0)+(value.readyState>1?5:0)+(!value.paused?10:0)};
}

// "No probe" never means "no playback": providers may expose neither
// an HTML5 <video> in a readable context nor playback events to the page.
export async function probeDebuggerTarget(sendCommand,target,expression) {
  let scanned=0;
  const probes=[];
  const evalIn=async (contextId,frameId=null)=>{
    scanned++;
    const args={expression,returnByValue:true,awaitPromise:false};
    if(Number.isSafeInteger(contextId))args.contextId=contextId;
    try{
      const response=await sendCommand(target,'Runtime.evaluate',args);
      const value=response?.result?.value;
      if(validProbe(value))probes.push({...rankedProbe(value),cdpTarget:target,cdpContextId:contextId??null,cdpFrameId:frameId});
    }catch{} // The frame may have navigated between discovery and evaluation.
  };
  await evalIn();
  // A successful main-world probe already includes reachable same-origin frames.
  if(probes.length)return {probes,scanned};
  let frames=[];
  try{
    const tree=await sendCommand(target,'Page.getFrameTree',{});
    frames=frameIds(tree?.frameTree);
  }catch{}
  // Page.createIsolatedWorld allows read-only video inspection in renderer
  // frames which are not accessible through the top page's JS context.
  for(const id of frames){
    try{
      const world=await sendCommand(target,'Page.createIsolatedWorld',{
        frameId:id,worldName:'FHAD VTT playback monitor',grantUniveralAccess:false
      });
      if(Number.isSafeInteger(world?.executionContextId))await evalIn(world.executionContextId,id);
    }catch{} // Unsupported or detached frame. Other frames may still work.
  }
  return {probes,scanned};
}
