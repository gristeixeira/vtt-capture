// Parsing pure, sem bibliotecas externas e sem acesso à página do utilizador.
export function isVttCandidate(url = '', mime = '') {
  return /\bvtt\b|webvtt/i.test(mime) || /\.vtt(?:$|[?#])|\.webvtt(?:$|[?#])|\b(?:subtitles?|captions?|texttracks?|timedtext|closedcaptions?)\b/i.test(url);
}
export function isHotmartPage(url = '') {
  try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)(hotmart\.com|hotmart\.com\.br|hotmartclub\.com)$/i.test(u.hostname); }
  catch { return false; }
}
export function slug(s, max = 90) {
  return String(s || 'aula-sem-titulo').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/[^\p{L}\p{N}._ -]/gu, '')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[-. ]+|[-. ]+$/g, '').slice(0, max) || 'aula-sem-titulo';
}
export function cleanText(s) {
  const entities = {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  return String(s || '').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => {
      if (e[0] === '#') { const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; }
      return entities[e.toLowerCase()] || _;
    }).replace(/[\t ]+/g, ' ').trim();
}
export function parseTimestamp(s) {
  const m = /^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1] || 0), min = Number(m[2]), sec = Number(m[3]), ms = Number(m[4]);
  if (min > 59 || sec > 59) return null;
  return (((h * 60 + min) * 60 + sec) * 1000 + ms);
}
export function formatTimestamp(ms) {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
export function parseVtt(source) {
  const text = String(source || '').replace(/^\uFEFF/, '').replace(/\r\n?/g,'\n');
  if (!/^WEBVTT(?:\s|$)/.test(text.trimStart())) return {valid:false, cues:[], map:null, reason:'Resposta sem cabeçalho WEBVTT'};
  const mapLine = text.match(/^X-TIMESTAMP-MAP\s*=\s*MPEGTS:(\d+),LOCAL:([^\s\r\n]+)/mi);
  const map = mapLine ? {mpegts:mapLine[1],local:mapLine[2]} : null;
  const blocks = text.split(/\n\s*\n/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (!lines.length || /^(WEBVTT|NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$)|X-TIMESTAMP)/i.test(lines[0])) continue;
    const arrowIndex = lines.findIndex((line, i) => i <= 1 && line.includes('-->'));
    if (arrowIndex === -1) continue;
    const timing = /^\s*(\S+)\s+-->\s+(\S+)(?:\s+(.*))?$/.exec(lines[arrowIndex]);
    if (!timing) continue;
    const start = parseTimestamp(timing[1]), end = parseTimestamp(timing[2]);
    if (start === null || end === null || end < start) continue;
    const raw = lines.slice(arrowIndex + 1).join('\n').trim();
    const spoken = cleanText(raw);
    if (!spoken) continue;
    cues.push({start, end, raw, text:spoken, settings:timing[3] || '', id:arrowIndex === 1 ? lines[0] : ''});
  }
  return {valid:true,cues,map};
}
export function uniqueCues(items) {
  const seen = new Set();
  return items.filter(c => { const k = `${c.start}|${c.end}|${c.text}`; if(seen.has(k))return false; seen.add(k); return true; })
    .sort((a,b) => a.start-b.start || a.end-b.end || (a.index ?? 0)-(b.index ?? 0));
}
export function exportFormats(lesson) {
  const cues = uniqueCues(lesson.cues || []);
  const displayName = lesson.title || 'Aula sem título';
  const lines = [];
  const vtt = 'WEBVTT\n\n' + cues.map(c => `${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}${c.settings?' '+c.settings:''}\n${c.raw}`).join('\n\n') + '\n';
  for (const c of cues) {
    const text = c.text.replace(/\s*\n\s*/g,' ');
    if (lines.at(-1) !== text) lines.push(text);
  }
  const txt = lines.join('\n') + '\n';
  const uncertain = lesson.confidence !== 'alta' || Boolean(lesson.overlapWarnings);
  const md = `# ${displayName}\n\n` +
    `- **Curso:** ${lesson.course || 'Não identificado'}\n` +
    `- **Página:** ${lesson.pageUrl || 'Não identificada'}\n` +
    `- **Início:** ${lesson.startedAt || ''}\n` +
    `- **Fim:** ${lesson.endedAt || 'Não encerrada'}\n` +
    `- **Confiança da identificação:** ${lesson.confidence || 'baixa'}${uncertain ? ' — VERIFICAR' : ''}\n` +
    `- **Segmentos WEBVTT:** ${lesson.segments || 0}\n` +
    `- **Cues únicos:** ${cues.length}\n` +
    (lesson.mergeSources?.length?`- **Capturas consolidadas:** ${lesson.mergeSources.length}\n- **Legendas duplicadas eliminadas no merge:** ${lesson.mergeRemovedCues||0}\n`:'' ) + '\n' +
    (lesson.warnings?.length ? `> **Verificar:** ${[...new Set(lesson.warnings)].join('; ')}\n\n` : '') +
    `## Transcrição\n\n${lines.map(l => l).join('\n\n')}\n`;
  const metadata = {
    schemaVersion:1, lessonId:lesson.id, course:lesson.course || null, title:displayName,
    pageUrl:lesson.pageUrl || null, startedAt:lesson.startedAt, endedAt:lesson.endedAt || null,
    identityConfidence:lesson.confidence, needsReview:uncertain || Boolean(lesson.warnings?.length),
    warnings:lesson.warnings || [], segmentsReceived:lesson.segments || 0, uniqueCues:cues.length,
    timestampMaps:lesson.timestampMaps || [], streamHosts:lesson.streamHosts || [],
    merge:lesson.mergeSources?.length?{
      originalCaptures:lesson.mergeSources.length,
      sourceIds:lesson.sourceIds || [],
      originalCues:lesson.mergeInputCues || null,
      duplicateCuesRemoved:lesson.mergeRemovedCues || 0,
      mergedAt:lesson.mergedAt || null,
      note:'O total de segmentos é a soma de pedidos recebidos nas capturas (pode incluir repetições). Apenas as falas foram deduplicadas por tempo e texto.'
    }:null,
    source:'FHAD VTT Capture 0.7.2', note:'A captura inclui apenas os segmentos de legendas carregados pelo player; rever a completude e autoria.'
  };
  return {vtt,txt,md,json:JSON.stringify(metadata,null,2)+'\n'};
}
