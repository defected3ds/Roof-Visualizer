const MAX_SIDE = 1536;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image'));
    img.src = src;
  });
}

/** Reads a picked/captured photo, applies EXIF rotation and downsizes it to a sensible upload size. */
export async function fileToDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * Builds the three "structure" previews shown while generating, the same kind of maps
 * (straight lines, hard edges, soft edges) that ControlNet-style pipelines condition on.
 */
export async function buildEdgeMaps(dataUrl: string): Promise<string[]> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];

  const blur = (src: Float32Array, radius: number) => {
    const tmp = new Float32Array(src.length);
    const out = new Float32Array(src.length);
    const span = radius * 2 + 1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
        tmp[y * w + x] = s / span;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = -radius; k <= radius; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
        out[y * w + x] = s / span;
      }
    return out;
  };

  const sobel = (src: Float32Array) => {
    const mag = new Float32Array(src.length);
    const dir = new Float32Array(src.length);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const p = (dx: number, dy: number) => src[(y + dy) * w + x + dx];
        const gx = -p(-1, -1) - 2 * p(-1, 0) - p(-1, 1) + p(1, -1) + 2 * p(1, 0) + p(1, 1);
        const gy = -p(-1, -1) - 2 * p(0, -1) - p(1, -1) + p(-1, 1) + 2 * p(0, 1) + p(1, 1);
        mag[y * w + x] = Math.hypot(gx, gy);
        dir[y * w + x] = Math.atan2(gy, gx);
      }
    return { mag, dir };
  };

  // Thin edges by keeping only local maxima along the gradient direction (Canny-style NMS).
  const thin = (mag: Float32Array, dir: Float32Array, threshold: number) => {
    const out = new Uint8ClampedArray(mag.length);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const m = mag[i];
        if (m < threshold) continue;
        const a = ((dir[i] * 180) / Math.PI + 180) % 180;
        const [dx, dy] = a < 22.5 || a >= 157.5 ? [1, 0] : a < 67.5 ? [1, 1] : a < 112.5 ? [0, 1] : [-1, 1];
        if (m >= mag[i + dy * w + dx] && m >= mag[i - dy * w - dx]) out[i] = 255;
      }
    return out;
  };

  const toUrl = (values: ArrayLike<number>) => {
    const out = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = values[i];
      out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = v;
      out.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(out, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.8);
  };

  const fine = sobel(blur(gray, 1));
  const coarse = sobel(blur(gray, 3));

  // 1. Strong structural lines only (roof edges, frames).
  const lines = thin(coarse.mag, coarse.dir, 90);
  // 2. All hard edges, including foliage — like a Canny map.
  const edges = thin(fine.mag, fine.dir, 60);
  // 3. Soft, glowing outlines — like an HED map.
  const softMag = blur(coarse.mag, 2);
  const soft = softMag.map((v) => Math.min(255, Math.pow(v / 160, 1.4) * 255));

  return [toUrl(lines), toUrl(edges), toUrl(soft)];
}

export async function shareImage(dataUrl: string, title: string) {
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${blob.type.split('/')[1] || 'png'}`, {
    type: blob.type,
  });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
