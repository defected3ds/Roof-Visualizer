/** The loading-screen slide for the roof measurement: the roof tinted on the photo, with rounded pitch and area at its centre. */
export interface MeasureSummary {
  pitchDeg?: number;
  areaM2?: number;
  /** Arrows along the eave and up the slope: [x1, y1, x2, y2] as fractions of the photo, and the length in metres (rounded). */
  eave?: { line: [number, number, number, number]; m: number };
  slope?: { line: [number, number, number, number]; m: number };
}

/** What /api/measure returns for visitors: rounded numbers and Depth Pro's coloured depth picture (only for a reliable result). */
export interface MeasureOutcome {
  summary?: MeasureSummary;
  depthColor?: string;
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

export async function buildMeasureCard(overlay: string, _mask: string, s: MeasureSummary): Promise<string> {
  const photo = await load(overlay);
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(photo, 0, 0, w, h);

  const label = Math.max(11, Math.round(w / 60));
  if (s.eave) arrow(ctx, s.eave.line, w, h, `about ${fmt(s.eave.m)} m`, label);
  if (s.slope) arrow(ctx, s.slope.line, w, h, `about ${fmt(s.slope.m)} m`, label);

  // Only the arrows with their lengths are drawn; the pitch and area are not written on the picture.
  return canvas.toDataURL('image/jpeg', 0.88);
}

const fmt = (m: number) => (Number.isInteger(m) ? String(m) : m.toFixed(1));

/** A double-headed arrow with its length written along it, like a measurement drawing. */
function arrow(ctx: CanvasRenderingContext2D, line: [number, number, number, number], w: number, h: number, text: string, size: number) {
  const [x1, y1, x2, y2] = [line[0] * w, line[1] * h, line[2] * w, line[3] * h];
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < w * 0.08) return;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.max(8, size * 0.9);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    for (const [px, py, dir] of [[x1, y1, 1], [x2, y2, -1]] as const) {
      for (const side of [-1, 1]) {
        ctx.moveTo(px, py);
        ctx.lineTo(px + dir * head * Math.cos(angle + side * 0.45), py + dir * head * Math.sin(angle + side * 0.45));
      }
    }
    ctx.stroke();
  };
  stroke('rgba(0,0,0,0.55)', Math.max(4, size * 0.34));
  stroke('#ffffff', Math.max(2, size * 0.16));
  // Label in the middle, turned along the arrow but never upside down.
  ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
  ctx.rotate(angle > Math.PI / 2 || angle < -Math.PI / 2 ? angle + Math.PI : angle);
  ctx.font = `600 ${size}px "Noto Sans", system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(-tw / 2 - size * 0.5, -size * 1.9, tw + size, size * 1.45, size * 0.3);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, 0, -size * 1.17);
  ctx.restore();
}

/** A caption label: text and the colour of the tint it names. */
export interface SlideLabel {
  text: string;
  color?: string;
}

export const WALL_LABEL: SlideLabel = { text: 'Walls found', color: '#2f7be0' };
export const ROOF_LABEL: SlideLabel = { text: 'Roof found', color: '#c01818' };

/** Captions stacked in the top-left corner of a loading-screen slide ("Walls found", then "Roof found"), each with a colour swatch. */
export async function captionSlide(src: string, labels: SlideLabel[] | string): Promise<string> {
  const list: SlideLabel[] = typeof labels === 'string' ? [{ text: labels }] : labels;
  const img = await load(src);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const size = Math.max(12, Math.round(w / 52));
  ctx.font = `600 ${size}px "Noto Sans", system-ui, sans-serif`;
  const margin = Math.round(w / 60);
  const swatch = size * 0.8;
  list.forEach((label, i) => {
    const tw = ctx.measureText(label.text).width;
    const boxW = tw + size * 1.4 + (label.color ? swatch + size * 0.5 : 0);
    const y = margin + i * size * 2.2;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(margin, y, boxW, size * 1.9, size * 0.35);
    ctx.fill();
    let x = margin + size * 0.7;
    if (label.color) {
      ctx.fillStyle = label.color;
      ctx.fillRect(x, y + (size * 1.9 - swatch) / 2, swatch, swatch);
      x += swatch + size * 0.5;
    }
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.text, x, y + size * 0.95);
  });
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** The wall slide with the roof tinted red on top, so the walls stay visible (blue) while the roof is shown. */
export async function roofOverWalls(wallOverlay: string, roofMask: string, text?: string): Promise<string> {
  const [base, mask] = await Promise.all([load(wallOverlay), load(roofMask)]);
  const w = base.naturalWidth;
  const h = base.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(mask, 0, 0, w, h);
  const m = ctx.getImageData(0, 0, w, h).data;
  const tint = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) tint.data.set([179, 0, 0, Math.round(m[i * 4] * 0.6)], i * 4);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(base, 0, 0, w, h);
  const layer = document.createElement('canvas');
  layer.width = w;
  layer.height = h;
  layer.getContext('2d')!.putImageData(tint, 0, 0);
  ctx.drawImage(layer, 0, 0);
  const out = canvas.toDataURL('image/jpeg', 0.88);
  return text ? captionSlide(out, text) : out;
}
