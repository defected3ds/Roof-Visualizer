/**
 * Roof segmentation: finds the roof in the house photo with CLIPSeg (text-prompted segmentation,
 * prompts "roof" and "roof tiles"), running in the browser via transformers.js like the depth map.
 * The mask is approximate; the prompt tells the image model to follow the real roof edges.
 */
import { loadTransformers } from './depth';

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

async function run(photo: string): Promise<RoofMask | null> {
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
    const scale = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
    const W = Math.round(img.naturalWidth * scale);
    const H = Math.round(img.naturalHeight * scale);
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
    return { mask, overlay: canvas.toDataURL('image/jpeg', 0.85) };
  } catch (err) {
    console.warn('Roof segmentation unavailable:', err);
    return null;
  }
}

/** Starts (or reuses) roof segmentation for a photo; runs alongside the depth map. */
export function roofMaskFor(photo: string): Promise<RoofMask | null> {
  let job = cache.get(photo);
  if (!job) {
    job = run(photo);
    cache.set(photo, job);
  }
  return job;
}

export function roofMaskWithin(photo: string, ms: number): Promise<RoofMask | null> {
  return Promise.race([roofMaskFor(photo), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}
