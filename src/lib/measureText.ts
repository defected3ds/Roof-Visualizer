/** The roof-measurement block of the prompt. Shared by the server (real numbers) and the admin preview (example numbers). */
import type { Product } from '../types';

export interface MeasureForText {
  confidence: 'ok' | 'low';
  /** True when a door or the camera height confirmed the metric scale; if not, only the pitch is sent. */
  scaleChecked?: boolean;
  /** How "up" was found: from a wall (reliable) or by assuming a level camera (the pitch can be off by the camera's tilt). */
  up?: 'wall' | 'level';
  planes: { pitchDeg: number; eaveM: number; slopeM: number; areaM2: number; share?: number }[];
}

/**
 * The roof pitch to show or send: only when "up" came from a wall and the larger planes agree (within 10°). A hip roof, a camera looking
 * down from above or a missing wall make a single number unreliable, and then none is given.
 */
export function reliablePitch(m: MeasureForText): number | undefined {
  if (m.up !== 'wall') return undefined;
  const big = m.planes.filter((p) => (p.share ?? 1) >= 0.15);
  if (!big.length) return undefined;
  const pitches = big.map((p) => p.pitchDeg);
  if (Math.max(...pitches) - Math.min(...pitches) > 10) return undefined;
  const total = big.reduce((s, p) => s + (p.share ?? 1), 0);
  return big.reduce((s, p) => s + p.pitchDeg * (p.share ?? 1), 0) / total;
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
  const pitch = reliablePitch(m);
  const cover = specMm(product, ['cover', 'width']);
  const gauge = specMm(product, ['batten', 'gauge']) ?? specMm(product, ['gauge']);
  if (!m.scaleChecked) {
    if (pitch === undefined) return '';
    return `ROOF MEASUREMENT (estimated from the photo): the roof has a pitch of about ${Math.round(pitch)}°. Use it only to understand the roof's slope; the photo and the product photos decide the result.`;
  }
  const lines = m.planes.map((p, i) => {
    let line = `Roof plane ${i + 1}: ${pitch !== undefined ? `pitch about ${Math.round(pitch)}°, ` : ''}eave about ${p.eaveM.toFixed(1)} m, slope length about ${p.slopeM.toFixed(1)} m, area about ${Math.round(p.areaM2)} m²`;
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
