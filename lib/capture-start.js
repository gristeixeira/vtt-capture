// Planeamento puro para o início seguro de uma sessão de captura.
export const normalizeCaptureUrl = (url) => {
  try { const u = new URL(url); return u.origin + u.pathname; }
  catch { return ''; }
};
export function previousCaptures(lessons, url) {
  const key = normalizeCaptureUrl(url);
  if (!key) return [];
  return (lessons || []).filter(l => !l.supersededBy && !l.mergeSources?.length &&
    normalizeCaptureUrl(l.pageUrl) === key)
    .map(l => ({id:l.id,title:l.title,segments:l.segments || 0, cueCount:l.cues?.length || 0,
      lastCueMs:Math.max(0,...(l.cues || []).map(c => Number(c.end) || 0)),startedAt:l.startedAt,endedAt:l.endedAt}))
    .sort((a,b) => String(b.startedAt||'').localeCompare(String(a.startedAt||'')));
}
export function captureStartDecision(lessons, url, mode, resumeLessonId) {
  const matches=previousCaptures(lessons,url);
  if(mode==='fresh') {
    if(matches.length)throw Error('Já existe uma captura desta aula. Escolhe continuar ou criar uma nova captura.');
    return {kind:'new',seconds:0};
  }
  if(mode==='restart')return {kind:'new',seconds:0};
  if(mode==='resume') {
    const prior=matches.find(l=>l.id===resumeLessonId);
    if(!prior)throw Error('A captura anterior já não está disponível ou não pertence a esta aula.');
    // Recolher alguns segundos anteriores à última fala para recuperar fragmentos.
    return {kind:'resume',lessonId:prior.id,seconds:Math.max(0,prior.lastCueMs/1000-8)};
  }
  throw Error('Modo de início inválido.');
}
