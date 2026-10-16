/**
 * Monocular depth estimation (Depth Anything V2, small) running in the browser with transformers.js.
 * The library and model are fetched from public CDNs the first time a photo is picked and cached by
 * the browser afterwards, so the app bundle and the server stay unchanged.
 */
import { reportProblem } from './report';
const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1';
const MODEL = 'onnx-community/depth-anything-v2-small';
/** The model works at ~518 px; smaller input keeps phones fast. */
const INPUT_SIDE = 640;
/** Size of the finished map (longest side). The model's own output is coarse; see sharpen(). */
const OUTPUT_SIDE = 1024;

export interface DepthMaps {
  /** Grey depth map: brighter is closer to the camera. Sent to the AI. */
  gray: string;
  /** The same map in colour, for the loading animation. */
  color: string;
}

let estimator: Promise<any> | null = null;
/** Set once WebGPU has failed on this device, so later photos go straight to WebAssembly. */
let gpuBroken = false;
const cache = new Map<string, Promise<DepthMaps | null>>();

let transformers: Promise<any> | null = null;

/** transformers.js, loaded from the CDN once and shared by the depth and roof-mask models. */
export function loadTransformers(): Promise<any> {
  transformers ??= import(/* @vite-ignore */ TRANSFORMERS_CDN);
  transformers.catch(() => (transformers = null));
  return transformers;
}

function loadEstimator() {
  estimator ??= (async () => {
    const { pipeline } = await loadTransformers();
    if ('gpu' in navigator && !gpuBroken) {
      try {
        return await pipeline('depth-estimation', MODEL, { device: 'webgpu', dtype: 'fp16' });
      } catch {
        gpuBroken = true; // No usable GPU adapter: fall back to WebAssembly.
      }
    }
    return pipeline('depth-estimation', MODEL, { device: 'wasm', dtype: 'q8' });
  })();
  estimator.catch(() => (estimator = null));
  return estimator;
}

/** Runs the model; if the GPU path fails while running (some phones), retries once on WebAssembly. */
async function estimate(input: string) {
  const model = await loadEstimator();
  try {
    return await model(input);
  } catch (err) {
    if (gpuBroken) throw err;
    console.warn('WebGPU depth estimation failed, retrying with WebAssembly:', err);
    gpuBroken = true;
    estimator = null;
    return (await loadEstimator())(input);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Magma-like colour ramp (dark purple → red → orange → pale yellow), like common depth visualisations.
const RAMP = [
  [0, 0, 4],
  [59, 15, 112],
  [140, 41, 129],
  [222, 73, 104],
  [254, 159, 109],
  [252, 253, 191],
];

function rampColour(v: number): number[] {
  const x = (v / 255) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const t = x - i;
  return RAMP[i].map((c, k) => Math.round(c + (RAMP[i + 1][k] - c) * t));
}

/** Box average over a (2r+1) window with edge clamping, via a summed-area table. */
function boxFilter(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const sum = sat[(y1 + 1) * (w + 1) + x1 + 1] - sat[y0 * (w + 1) + x1 + 1] - sat[(y1 + 1) * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

/**
 * Sharpens a coarse depth map along the photo's edges. A guided filter (the photo is the guide) snaps depth edges
 * to the real edges (roof ridge, eaves, house outline); it is only used in a band around the depth edges of the
 * coarse map, so flat areas stay smooth and the texture of the photo (tile rows) does not leak into the depth map.
 * Values are 0..1.
 */
function sharpen(depth: Float32Array, guide: Float32Array, w: number, h: number, r: number): Float32Array {
  const refined = guidedFilter(depth, guide, w, h, r, 0.001);
  // Depth edges of the coarse map, widened and feathered into a blend weight.
  const smooth = boxFilter(depth, w, h, 1);
  const edge = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = (smooth[i + 1] - smooth[i - 1]) / 2;
      const gy = (smooth[i + w] - smooth[i - w]) / 2;
      edge[i] = Math.hypot(gx, gy) > 0.08 ? 1 : 0; // only strong depth steps: house vs sky or background
    }
  }
  const band = boxFilter(edge, w, h, r);
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const k = Math.min(1, band[i] * 8);
    out[i] = depth[i] * (1 - k) + refined[i] * k;
  }
  return out;
}

function guidedFilter(depth: Float32Array, guide: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const mulIp = new Float32Array(n);
  const mulII = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mulIp[i] = guide[i] * depth[i];
    mulII[i] = guide[i] * guide[i];
  }
  const mI = boxFilter(guide, w, h, r);
  const mp = boxFilter(depth, w, h, r);
  const mIp = boxFilter(mulIp, w, h, r);
  const mII = boxFilter(mulII, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxFilter(a, w, h, r);
  const mb = boxFilter(b, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.min(1, Math.max(0, ma[i] * guide[i] + mb[i]));
  return out;
}

/** Stretches the values so the 1st..99th percentile fills 0..1: the nearest and farthest parts use the full range. */
function stretch(values: Float32Array): void {
  const hist = new Uint32Array(1024);
  for (const v of values) hist[Math.min(1023, Math.max(0, Math.round(v * 1023)))]++;
  const cut = (share: number) => {
    let sum = 0;
    for (let i = 0; i < 1024; i++) {
      sum += hist[i];
      if (sum >= share * values.length) return i / 1023;
    }
    return 1;
  };
  const lo = cut(0.01);
  const hi = cut(0.99);
  if (hi - lo < 0.05) return;
  for (let i = 0; i < values.length; i++) values[i] = Math.min(1, Math.max(0, (values[i] - lo) / (hi - lo)));
}

async function run(photo: string): Promise<DepthMaps | null> {
  try {
    const img = await loadImage(photo);
    const scale = Math.min(1, INPUT_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);

    const { depth } = await estimate(canvas.toDataURL('image/jpeg', 0.9));

    // Final size: the photo's proportions, up to OUTPUT_SIDE. The model's map is coarse (its output is built from
    // 14 px patches), so it is scaled up and then sharpened along the photo's edges.
    const outScale = Math.min(1, OUTPUT_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * outScale);
    const h = Math.round(img.naturalHeight * outScale);
    const raw = document.createElement('canvas');
    raw.width = depth.width;
    raw.height = depth.height;
    const rawCtx = raw.getContext('2d')!;
    const rawData = rawCtx.createImageData(depth.width, depth.height);
    for (let i = 0; i < depth.width * depth.height; i++) {
      const v = depth.data[i * depth.channels];
      rawData.data.set([v, v, v, 255], i * 4);
    }
    rawCtx.putImageData(rawData, 0, 0);

    const work = document.createElement('canvas');
    work.width = w;
    work.height = h;
    const wctx = work.getContext('2d', { willReadFrequently: true })!;
    wctx.imageSmoothingQuality = 'high';
    wctx.drawImage(raw, 0, 0, w, h);
    const up = wctx.getImageData(0, 0, w, h).data;
    wctx.drawImage(img, 0, 0, w, h);
    const px = wctx.getImageData(0, 0, w, h).data;
    const coarse = new Float32Array(w * h);
    const guide = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      coarse[i] = up[i * 4] / 255;
      guide[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
    }
    const radius = Math.max(4, Math.round(Math.max(w, h) / 128));
    const sharp = sharpen(coarse, guide, w, h, radius);
    stretch(sharp);

    const gray = wctx.createImageData(w, h);
    const color = wctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = Math.round(sharp[i] * 255);
      gray.data.set([v, v, v, 255], i * 4);
      const [r, g, b] = rampColour(v);
      color.data.set([r, g, b, 255], i * 4);
    }
    const toUrl = (data: ImageData) => {
      wctx.putImageData(data, 0, 0);
      return work.toDataURL('image/jpeg', 0.92);
    };
    return { gray: toUrl(gray), color: toUrl(color) };
  } catch (err) {
    console.warn('Depth estimation unavailable:', err);
    reportProblem('depth', err);
    return null;
  }
}

/** Starts (or reuses) depth estimation for a photo. Resolves to null when the device can't run it. */
export function depthFor(photo: string): Promise<DepthMaps | null> {
  let job = cache.get(photo);
  if (!job) {
    job = run(photo);
    cache.set(photo, job);
  }
  return job;
}

/** Waits for the depth map, but never longer than `ms`, so a slow phone doesn't hold up generation. */
export function depthWithin(photo: string, ms: number): Promise<DepthMaps | null> {
  return Promise.race([depthFor(photo), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}
