/** The loading-screen slide for the roof measurement: the roof tinted on the photo, with rounded pitch and area at its centre. */
export interface MeasureSummary {
  pitchDeg: number;
  areaM2: number;
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

export async function buildMeasureCard(overlay: string, mask: string, s: MeasureSummary): Promise<string> {
  const [photo, m] = await Promise.all([load(overlay), load(mask)]);
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(photo, 0, 0, w, h);

  // Centre of the roof: average position of the white pixels of the mask.
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  pctx.drawImage(m, 0, 0, w, h);
  const data = pctx.getImageData(0, 0, w, h).data;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < h; y += 4) {
    for (let x = 0; x < w; x += 4) {
      if (data[(y * w + x) * 4] > 127) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  const cx = n ? sx / n : w / 2;
  const cy = n ? sy / n : h / 2;

  const size = Math.max(14, Math.round(w / 34));
  const lines = [`Roof pitch about ${s.pitchDeg}°`, `Roof area about ${s.areaM2} m²`];
  ctx.font = `600 ${size}px "Noto Sans", system-ui, sans-serif`;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const padX = size * 0.8;
  const padY = size * 0.6;
  const boxW = textW + padX * 2;
  const boxH = lines.length * size * 1.35 + padY * 2 - size * 0.35;
  const x = Math.min(w - boxW - 8, Math.max(8, cx - boxW / 2));
  const y = Math.min(h - boxH - 8, Math.max(8, cy - boxH / 2));
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, size * 0.4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + i * size * 1.35));
  return canvas.toDataURL('image/jpeg', 0.88);
}
