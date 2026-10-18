/** The roof-measurement block of the prompt. Shared by the server (real numbers) and the admin preview (example numbers). */
import type { Product } from '../types';

export interface MeasureForText {
  confidence: 'ok' | 'low';
  /** True when a door or the camera height confirmed the metric scale; if not, only the pitch is sent. */
  scaleChecked?: boolean;
  planes: { pitchDeg: number; eaveM: number; slopeM: number; areaM2: number }[];
}

/** First number (mm) in a spec whose label contains one of the words, e.g. "Cover width: 165 mm". */
function specMm(product: Product | undefined, words: string[]): number | undefined {
  for (const s of product?.specs ?? []) {
    const label = s.label.toLowerCase();
    if (!words.every((w) => label.includes(w))) continue;
    const v = /(\d+(?:[.,]\d+)?)\s*(mm|cm|m)?\b/i.exec(s.value);
    if (!v) continue;
    const num = Number(v[1].replace(',', '.'));
    const unit = (v[2] || 'mm').toLowerCase();
    return unit === 'm' ? num * 1000 : unit === 'cm' ? num * 10 : num;
  }
  return undefined;
}

/**
 * The measurement block added to the prompt, or '' when the measurement is missing or not reliable. Numbers are guides: the model
 * is told to follow the photo and the product photos where they disagree.
 */
export function measurementText(m: MeasureForText | undefined, product?: Product): string {
  if (!m || m.confidence !== 'ok' || !m.planes.length) return '';
  const cover = specMm(product, ['cover', 'width']);
  const gauge = specMm(product, ['batten', 'gauge']) ?? specMm(product, ['gauge']);
  if (!m.scaleChecked) {
    const p = m.planes[0];
    return `ROOF MEASUREMENT (estimated from the photo): the main roof plane has a pitch of about ${Math.round(p.pitchDeg)}°. Use it only to understand the roof's slope; the photo and the product photos decide the result.`;
  }
  const lines = m.planes.map((p, i) => {
    let line = `Roof plane ${i + 1}: pitch about ${Math.round(p.pitchDeg)}°, eave about ${p.eaveM.toFixed(1)} m, slope length about ${p.slopeM.toFixed(1)} m, area about ${Math.round(p.areaM2)} m²`;
    if (cover && gauge) {
      const per = Math.max(1, Math.round((p.eaveM * 1000) / cover));
      const courses = Math.max(1, Math.round((p.slopeM * 1000) / gauge));
      line += `. With this tile: about ${courses} courses of about ${per} tiles`;
    }
    return `- ${line}.`;
  });
  return [
    'ROOF MEASUREMENTS (estimated from the photo, about ±10–15%; a guide for the scale of the tiles only):',
    ...lines,
    'Use them only to judge how large the tiles are against the roof. Do not count tiles or force these numbers: the photo and the product photos decide the result.',
  ].join('\n');
}