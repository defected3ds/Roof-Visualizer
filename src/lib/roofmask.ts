/**
 * Roof segmentation. With SAM 3 switched on (/admin > AI settings) the server asks Meta SAM 3 on fal.ai for
 * sharp roof masks; otherwise, or when that fails, CLIPSeg (text-prompted, "roof" / "roof tiles") runs in the
 * browser via transformers.js like the depth map. CLIPSeg masks are approximate.
 */
import { loadTransformers } from './depth';
import { reportProblem } from './report';

const MODEL = 'Xenova/clipseg-rd64-refined';
const PROMPTS = ['roof', 'roof tiles'];
/** Probability where the soft mask edge starts and where it is fully white. */
const LOW = 0.15;
const HIGH = 0.35;

export interface RoofMask {
  /** Black and white mask (white = roof), sent to the AI. */
  mask: string;
  /** The photo with the roof tinted red, for the loading animation. */
  overlay: string;
  /** Which tool made it. */
  source: 'sam3' | 'clipseg';
}

/** Set from /api/health: which tool to use, and the access code for /api/roof-mask. */
const config = { tool: 'clipseg' as 'sam3' | 'clipseg', accessCode: '', headers: {} as Record<string, string> };
export function configureRoofMask(next: Partial<typeof config>) {
  Object.assign(config, next);
}

let segmenter: Promise<{ tokenizer: any; processor: any; model: any; RawImage: any }> | null = null;
const cache = new Map<string, Promise<RoofMask | null>>();

function loadSegmenter() {
  segmenter ??= (async () => {
    const T = await loadTransformers();
    const [tokenizer, processor, model] = await Promise.all([
      T.AutoTokenizer.from_pretrained(MODEL),
      T.AutoProcessor.from_pretrained(MODEL),
      T.CLIPSegForImageSegmentation.from_pretrained(MODEL, { dtype: 'q8' }),
    ]);
    return { tokenizer, processor, model, RawImage: T.RawImage };
  })();
  segmenter.catch(() => (segmenter = null));
  return segmenter;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Size of the mask and overlay: the photo's proportions, at most 1024 px. */
function maskSize(img: HTMLImageElement) {
  const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
  return { W: Math.round(img.naturalWidth * scale), H: Math.round(img.naturalHeight * scale) };
}

/** SAM 3 via the server: merges the masks of all roofs found into one. */
async function runSam3(photo: string): Promise<RoofMask | null> {
  const res = await fetch('/api/roof-mask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Access-Code': config.accessCode, ...config.headers },
    body: JSON.stringify({ image: photo }),
  });
  if (!res.ok) throw new Error(`roof mask ${res.status}`);
  const { masks } = (await res.json()) as { masks: string[] };
  return mergeMasks(photo, masks);
}

/** Merges SAM 3 masks (one per roof found) into one mask plus the red-tinted preview. */
export async function mergeMasks(photo: string, masks: string[]): Promise<RoofMask | null> {
  if (!masks?.length) return null;
  const img = await loadImage(photo);
  const { W, H } = maskSize(img);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const roof = new Uint8ClampedArray(W * H);
  for (const src of masks) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(await loadImage(src), 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    // White (or opaque light) pixels are the roof; black or transparent ones are not.
    for (let i = 0; i < W * H; i++) {
      const v = d[i * 4 + 3] < 128 ? 0 : (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3;
      if (v > roof[i]) roof[i] = v;
    }
  }
  const result = paint(img, W, H, roof);
  return result && { ...result, source: 'sam3' };
}

/** Black-and-white mask for the AI and a red-tinted photo for the loading animation. */
function paint(img: HTMLImageElement, W: number, H: number, roof: Uint8ClampedArray): Omit<RoofMask, 'source'> | null {
  let roofPixels = 0;
  for (const v of roof) if (v > 127) roofPixels++;
  // No roof found (e.g. a photo without a house): don't send a misleading empty mask.
  if (roofPixels < W * H * 0.01) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(W, H);
  const tint = ctx.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    out.data.set([roof[i], roof[i], roof[i], 255], i * 4);
    tint.data.set([179, 0, 0, Math.round(roof[i] * 0.6)], i * 4);
  }
  ctx.putImageData(out, 0, 0);
  const mask = canvas.toDataURL('image/png');
  const layer = document.createElement('canvas');
  layer.width = W;
  layer.height = H;
  layer.getContext('2d')!.putImageData(tint, 0, 0);
  ctx.drawImage(img, 0, 0, W, H);
  ctx.drawImage(layer, 0, 0);
  return { mask, overlay: canvas.toDataURL('image/jpeg', 0.85) };
}

async function run(photo: string): Promise<RoofMask | null> {
  if (config.tool === 'sam3') {
    try {
      const result = await runSam3(photo);
      if (result) return result;
    } catch (err) {
      console.warn('SAM 3 roof mask unavailable, using CLIPSeg:', err);
      reportProblem('roof mask (SAM 3)', err);
    }
  }
  return runClipSeg(photo);
}

async function runClipSeg(photo: string): Promise<RoofMask | null> {
  try {
    const { tokenizer, processor, model, RawImage } = await loadSegmenter();
    const img = await loadImage(photo);
    const image = await RawImage.read(photo);
    const text = tokenizer(PROMPTS, { padding: true, truncation: true });
    const inputs = await processor(PROMPTS.map(() => image));
    const { logits } = await model({ ...text, pixel_values: inputs.pixel_values });
    const [n, h, w] = logits.dims as number[];
    const data = logits.data as Float32Array;

    // Combine the prompts (highest probability wins) into a soft-edged mask and a red tint layer.
    const small = document.createElement('canvas');
    small.width = w;
    small.height = h;
    const sctx = small.getContext('2d')!;
    const out = sctx.createImageData(w, h);
    const tint = sctx.createImageData(w, h);
    let roofPixels = 0;
    for (let i = 0; i < w * h; i++) {
      let p = 0;
      for (let k = 0; k < n; k++) p = Math.max(p, 1 / (1 + Math.exp(-data[k * w * h + i])));
      const v = Math.round(Math.min(1, Math.max(0, (p - LOW) / (HIGH - LOW))) * 255);
      if (v > 127) roofPixels++;
      out.data.set([v, v, v, 255], i * 4);
      tint.data.set([179, 0, 0, Math.round(v * 0.6)], i * 4); // wienerberger red, see-through where the roof is
    }
    // No roof found (e.g. a photo without a house): don't send a misleading empty mask.
    if (roofPixels < w * h * 0.01) return null;

    // Scale back to the photo's proportions.
    const { W, H } = maskSize(img);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';

    sctx.putImageData(out, 0, 0);
    ctx.drawImage(small, 0, 0, W, H);
    const mask = canvas.toDataURL('image/png');

    // Overlay for the loading animation: the photo with the roof tinted red.
    sctx.putImageData(tint, 0, 0);
    ctx.drawImage(img, 0, 0, W, H);
    ctx.drawImage(small, 0, 0, W, H);
    return { mask, overlay: canvas.toDataURL('image/jpeg', 0.85), source: 'clipseg' };
  } catch (err) {
    console.warn('Roof segmentation unavailable:', err);
    reportProblem('roof mask (CLIPSeg)', err);
    return null;
  }
}

/** Starts (or reuses) roof segmentation for a photo; runs alongside the depth map. */
export function roofMaskFor(photo: string): Promise<RoofMask | null> {
  const key = `${config.tool}:${photo}`;
  let job = cache.get(key);
  if (!job) {
    job = run(photo);
    cache.set(key, job);
  }
  return job;
}

export function roofMaskWithin(photo: string, ms: number): Promise<RoofMask | null> {
  return Promise.race([roofMaskFor(photo), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}
