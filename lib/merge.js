// Ferramentas puras de consolidação: nunca eliminam as capturas originais.
const norm = value => String(value || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-PT');
export const sameLesson = (a, b) =>
  norm(a?.title) === norm(b?.title) && Boolean(a?.pageUrl) && a.pageUrl === b?.pageUrl;

function cueText(cue) {
  return norm(cue.text).replace(/[\s.,!?;:…]+$/gu, '');
}
// Deduplicação conservadora: texto equivalente, inícios e fins coincidentes
// (admite pequenas diferenças de arredondamento entre segmentos VTT).
// Uma frase repetida noutra posição temporal é preservada.
export function mergeCues(sources, toleranceMs = 180) {
  const tolerance = Math.max(0, Math.min(500, toleranceMs));
  const bucketMs = Math.max(1, tolerance || 1);
  const output = [];
  const buckets = new Map();
  let considered = 0;
  const input = sources.flatMap(source => source.cues || []).filter(c =>
    Number.isFinite(c.start) && Number.isFinite(c.end) && c.end >= c.start && cueText(c));
  input.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const cue of input) {
    considered++;
    const keyText = cueText(cue);
    const bucket = Math.floor(cue.start / bucketMs);
    let duplicate = false;
    for (let i = bucket - 1; i <= bucket + 1 && !duplicate; i++) {
      const matches = buckets.get(`${keyText}|${i}`) || [];
      duplicate = matches.some(other => Math.abs(other.start - cue.start) <= tolerance &&
        Math.abs(other.end - cue.end) <= tolerance);
    }
    if (duplicate) continue;
    output.push({...cue, index:output.length});
    const key = `${keyText}|${bucket}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(cue);
  }
  return {cues:output, inputCount:considered, removed:considered - output.length};
}
