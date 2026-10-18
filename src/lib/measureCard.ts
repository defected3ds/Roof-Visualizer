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

export async function buildMeasureCard(overlay: string, _mask: string, s: MeasureSummary): Promise<string> {
  const photo = await load(overlay);
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(photo, 0, 0, w, h);

  const size = Math.max(11, Math.round(w / 60));
  const lines = [`Roof pitch about ${s.pitchDeg}°`, `Roof area about ${s.areaM2} m²`];
  ctx.font = `600 ${size}px "Noto Sans", system-ui, sans-serif`;
  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const padX = size * 0.7;
  const padY = size * 0.5;
  const boxW = textW + padX * 2;
  const boxH = lines.length * size * 1.3 + padY * 2 - size * 0.3;
  const margin = Math.round(w / 60);
  const x = margin;
  const y = h - boxH - margin;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, size * 0.35);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + i * size * 1.3));
  return canvas.toDataURL('image/jpeg', 0.88);
}
