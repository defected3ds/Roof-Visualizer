import { GoogleGenAI } from '@google/genai';
import type { Category, Product } from '../src/types';

export interface GenerateRequest {
  /** The house photo as a data URL. */
  image: string;
  product: Product;
  category?: Category;
  /** Product photos (or a drawn texture) as data URLs, sent to the model after the house photo. */
  references: string[];
  /** True when the references are real product photos rather than a drawn texture. */
  photoReferences: boolean;
  /** Depth map of the house photo (brighter = closer), sent right after the photo to convey 3D shape. */
  depth?: string;
  count: number;
}

export interface Provider {
  name: string;
  generate(req: GenerateRequest): Promise<string[]>;
}

/**
 * The instruction that does the real work. It tells the model to treat the photo as fixed
 * and change only the roof covering, which is what the edge-map / inpaint pipeline of
 * dedicated apps enforces. Modern instruction-following image editors respect it well.
 */
export function buildPrompt(req: GenerateRequest, variant: number): string {
  const { product, category } = req;
  const label = [product.brand, product.name].filter(Boolean).join(' ');
  const kind = category ? ` ${category.name.toLowerCase()}` : '';
  const lines = [
    `Edit this photo of a house (the first image): replace ONLY the roof covering with the${kind} roofing product "${label}".`,
    ...(category?.description ? [`Product type: ${category.description}`] : []),
    `Product details: ${product.description}`,
    ...(product.specs.length
      ? [`Technical data (use it for the correct tile size, proportions and colour): ${product.specs.map((s) => `${s.label}: ${s.value}`).join('; ')}.`]
      : []),
    'Keep everything else pixel-identical: the same camera angle, framing, walls, windows, doors, chimneys, gutters, trim, sky, trees, people and lighting.',
    'Preserve the exact roof geometry: ridges, hips, valleys, dormers, eaves and pitch must not move or change shape.',
    'Lay the new material in correct perspective following each roof plane, with realistic scale, course lines, ridge caps, shadows and weathering matching the photo light.',
    'The result must look like a real, unedited photograph, not a render.',
  ];
  let next = 2;
  if (req.depth) {
    lines.push(
      `Image ${next} is a depth map of the house photo (brighter = closer to the camera). Use it only to understand the 3D shape: which surfaces are roof, the orientation and pitch of each roof plane, and where ridges, hips, valleys and eaves are. Lay the tile courses so they follow those planes in perspective. Never draw the depth map into the result.`,
    );
    next += 1;
  }
  if (req.references.length > 0) {
    const last = next + req.references.length - 1;
    const which = req.references.length === 1 ? `Image ${next} is` : `Images ${next} to ${last} are`;
    lines.push(
      req.photoReferences
        ? `${which} reference photos of this exact product: reproduce its shape and profile, colour and colour variation, surface finish and size as faithfully as possible. Use them only as a material reference, never copy their background or composition.`
        : `${which} a texture sample of the material: match its colour, profile and pattern.`,
    );
  }
  if (variant > 0) {
    lines.push(`Variation ${variant + 1}: allow natural, subtle differences in colour blend and weathering.`);
  }
  return lines.join(' ');
}

function splitDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL');
  return { mimeType: match[1], data: match[2] };
}

// ---------------------------------------------------------------------------
// Gemini image editing (default when GEMINI_API_KEY is set)
// ---------------------------------------------------------------------------

// Nano Banana 2.1 first; older image models only if the key has no access to it.
const DEFAULT_GEMINI_MODELS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

function geminiProvider(apiKey: string): Provider {
  const ai = new GoogleGenAI({ apiKey });
  const models = process.env.GEMINI_IMAGE_MODEL ? [process.env.GEMINI_IMAGE_MODEL] : DEFAULT_GEMINI_MODELS;
  let workingModel: string | null = null;

  async function once(req: GenerateRequest, variant: number): Promise<string | null> {
    const parts: any[] = [{ inlineData: splitDataUrl(req.image) }];
    if (req.depth) parts.push({ inlineData: splitDataUrl(req.depth) });
    for (const ref of req.references) parts.push({ inlineData: splitDataUrl(ref) });
    parts.push({ text: buildPrompt(req, variant) });

    let lastErr: unknown;
    for (const model of workingModel ? [workingModel] : models) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config: { responseModalities: ['IMAGE', 'TEXT'] },
        });
        if (workingModel !== model) console.log(`[gemini] using model ${model}`);
        workingModel = model;
        const out = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        return out?.inlineData ? `data:${out.inlineData.mimeType || 'image/png'};base64,${out.inlineData.data}` : null;
      } catch (err: any) {
        lastErr = err;
        console.warn(`[gemini] model ${model} failed: ${err?.message}`);
        // Fall through to the next model only when this one doesn't exist for the key.
        if (!/not found|404|not supported/i.test(String(err?.message))) throw err;
      }
    }
    throw lastErr;
  }

  return {
    name: 'gemini',
    async generate(req) {
      const results = await Promise.allSettled(Array.from({ length: req.count }, (_, i) => once(req, i)));
      const images = results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
      const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (images.length === 0 && firstError) throw firstError.reason;
      return images;
    },
  };
}

// ---------------------------------------------------------------------------
// Replicate: FLUX.1 Kontext (instruction-based image editing)
// ---------------------------------------------------------------------------

const REPLICATE_API = 'https://api.replicate.com/v1';

function replicateProvider(token: string): Provider {
  const model = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-kontext-pro';
  const headers = { Authorization: `Bearer ${token}` };

  async function upload(dataUrl: string): Promise<string> {
    const { mimeType, data } = splitDataUrl(dataUrl);
    const form = new FormData();
    form.append('content', new Blob([Buffer.from(data, 'base64')], { type: mimeType }), 'house.jpg');
    const res = await fetch(`${REPLICATE_API}/files`, { method: 'POST', headers, body: form });
    if (!res.ok) throw new Error(`Replicate upload failed: ${res.status} ${await res.text()}`);
    return (await res.json()).urls.get;
  }

  async function predict(input: Record<string, unknown>): Promise<string> {
    let res = await fetch(`${REPLICATE_API}/models/${model}/predictions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'wait=60' },
      body: JSON.stringify({ input }),
    });
    if (!res.ok) throw new Error(`Replicate error: ${res.status} ${await res.text()}`);
    let prediction = await res.json();
    const deadline = Date.now() + 5 * 60_000;
    while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
      if (Date.now() > deadline) throw new Error('Replicate prediction timed out');
      await new Promise((r) => setTimeout(r, 1500));
      res = await fetch(prediction.urls.get, { headers });
      prediction = await res.json();
    }
    if (prediction.status !== 'succeeded') throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? ''}`);
    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    // Inline the result so the browser can share/download it without CORS issues.
    const img = await fetch(url);
    const type = img.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
  }

  return {
    name: 'replicate',
    async generate(req) {
      const imageUrl = await upload(req.image);
      const results = await Promise.allSettled(
        Array.from({ length: req.count }, (_, i) =>
          predict({
            // FLUX Kontext takes a single image, so the product is described in text only.
            prompt: buildPrompt({ ...req, references: [], depth: undefined }, i),
            input_image: imageUrl,
            aspect_ratio: 'match_input_image',
            output_format: 'jpg',
            seed: Math.floor(Math.random() * 1e9),
          }),
        ),
      );
      const images = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      if (images.length === 0 && firstError) throw firstError.reason;
      return images;
    },
  };
}

// ---------------------------------------------------------------------------
// Demo mode: no API key configured. Echoes the photo so the whole UI can be tried.
// ---------------------------------------------------------------------------

const demoProvider: Provider = {
  name: 'demo',
  async generate(req) {
    await new Promise((r) => setTimeout(r, 4000));
    return Array.from({ length: req.count }, () => req.image);
  },
};

export function pickProvider(): Provider {
  const { AI_PROVIDER, GEMINI_API_KEY, REPLICATE_API_TOKEN } = process.env;
  if (AI_PROVIDER === 'demo') return demoProvider;
  if (AI_PROVIDER === 'replicate' && REPLICATE_API_TOKEN) return replicateProvider(REPLICATE_API_TOKEN);
  if (GEMINI_API_KEY) return geminiProvider(GEMINI_API_KEY);
  if (REPLICATE_API_TOKEN) return replicateProvider(REPLICATE_API_TOKEN);
  return demoProvider;
}
