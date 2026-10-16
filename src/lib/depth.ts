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

async function run(photo: string): Promise<DepthMaps | null> {
  try {
    const img = await loadImage(photo);
    const scale = Math.min(1, INPUT_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);

    const { depth } = await estimate(canvas.toDataURL('image/jpeg', 0.9));

    // The model returns a map at its own resolution; draw it back at the photo's proportions.
    const raw = document.createElement('canvas');
    raw.width = depth.width;
    raw.height = depth.height;
    const rawCtx = raw.getContext('2d')!;
    const gray = rawCtx.createImageData(depth.width, depth.height);
    const color = rawCtx.createImageData(depth.width, depth.height);
    for (let i = 0; i < depth.width * depth.height; i++) {
      const v = depth.data[i * depth.channels];
      gray.data.set([v, v, v, 255], i * 4);
      const [r, g, b] = rampColour(v);
      color.data.set([r, g, b, 255], i * 4);
    }
    const toUrl = (data: ImageData) => {
      rawCtx.putImageData(data, 0, 0);
      ctx.drawImage(raw, 0, 0, w, h);
      return canvas.toDataURL('image/jpeg', 0.85);
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
