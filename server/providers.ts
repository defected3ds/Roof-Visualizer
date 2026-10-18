import { GoogleGenAI } from '@google/genai';
import { imageLimit as imageLimitFor } from '../src/lib/models';
import { DEFAULT_SYSTEM_PROMPT } from '../src/lib/prompt';
import type { AiSettings, DepthSettings, MeasurementSettings, ProviderConfig, SegmentationSettings } from '../src/types';

/** What every image model receives: the ordered images (house photo first) and one prompt per variant. */
export interface ModelInput {
  images: string[];
  prompts: string[];
}

export interface Provider {
  name: string;
  generate(input: ModelInput): Promise<string[]>;
}

export { imageLimit, PROVIDER_TYPES } from '../src/lib/models';

/** Env variable names a provider may read its key from; never the app's own secrets. */
const KEY_ENV = /^[A-Z][A-Z0-9_]*(KEY|TOKEN)$/;
const RESERVED_ENV = new Set(['GITHUB_TOKEN']);

export function validKeyEnv(name: string) {
  return KEY_ENV.test(name) && !RESERVED_ENV.has(name);
}

export function hasKey(cfg: ProviderConfig): boolean {
  return cfg.type === 'demo' || (validKeyEnv(cfg.keyEnv) && Boolean(process.env[cfg.keyEnv]));
}

/** SAM 3 when a fal.ai key is set (FAL_API_KEY or FAL_KEY), else CLIPSeg in the browser. */
function defaultSegmentation(): SegmentationSettings {
  const keyEnv = process.env.FAL_API_KEY || !process.env.FAL_KEY ? 'FAL_API_KEY' : 'FAL_KEY';
  return { tool: process.env[keyEnv] ? 'sam3' : 'clipseg', keyEnv, prompt: 'roof' };
}

function defaultDepth(): DepthSettings {
  return { tool: 'browser', keyEnv: process.env.FAL_API_KEY || !process.env.FAL_KEY ? 'FAL_API_KEY' : 'FAL_KEY', quality: 'balanced' };
}

export function defaultMeasurement(): MeasurementSettings {
  return { tool: 'off', keyEnv: 'REPLICATE_API_TOKEN', wallPrompt: 'wall', referencePrompt: 'door', referenceHeightM: 2, groundPrompt: 'ground', cameraHeightM: 1.6, waitSeconds: 60, depthHost: 'chenxwh', show: true };
}

export function hasMeasurementKey(m: MeasurementSettings): boolean {
  return validKeyEnv(m.keyEnv) && Boolean(process.env[m.keyEnv]);
}

export function hasDepthKey(d: DepthSettings): boolean {
  return validKeyEnv(d.keyEnv) && Boolean(process.env[d.keyEnv]);
}

/** Marigold presets: denoising steps, ensemble size (predictions averaged) and processing resolution. */
const MARIGOLD_QUALITY = {
  fast: { num_inference_steps: 5, ensemble_size: 3, processing_res: 768 },
  balanced: { num_inference_steps: 10, ensemble_size: 5, processing_res: 768 },
  best: { num_inference_steps: 10, ensemble_size: 10, processing_res: 1024 },
};

/**
 * Depth map on fal.ai through the queue API: Marigold (fal-ai/imageutils/marigold-depth) or MiDaS (fal-ai/imageutils/depth). Returns the
 * grey depth image as a data URL; the browser orients and sharpens it.
 */
export async function estimateDepth(d: DepthSettings, image: string): Promise<string> {
  const apiKey = process.env[d.keyEnv];
  if (!apiKey) throw new Error(`${d.keyEnv} is not set`);
  const headers = { Authorization: `Key ${apiKey}` };
  const midas = d.tool === 'midas';
  const res = await fetch(`${FAL_QUEUE}/fal-ai/imageutils/${midas ? 'depth' : 'marigold-depth'}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(midas ? { image_url: image } : { image_url: image, ...MARIGOLD_QUALITY[d.quality] }),
  });
  if (!res.ok) throw new Error(`fal.ai ${midas ? 'MiDaS' : 'Marigold'} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const job = await res.json();
  await poll(
    async () => {
      const st = await (await fetch(job.status_url, { headers })).json();
      if (st.status === 'COMPLETED') {
        if (st.error) throw new Error(`fal.ai ${midas ? 'MiDaS' : 'Marigold'} failed: ${st.error}`);
        return true;
      }
      return undefined;
    },
    midas ? 'fal.ai MiDaS' : 'fal.ai Marigold',
    1000,
    120_000,
  );
  const out = await (await fetch(job.response_url, { headers })).json();
  const url: string | undefined = out.image?.url;
  if (!url) throw new Error(`${midas ? 'MiDaS' : 'Marigold'} returned no image: ${JSON.stringify(out).slice(0, 300)}`);
  return url.startsWith('data:') ? url : urlToDataUrl(url);
}

export function hasSegmentationKey(seg: SegmentationSettings): boolean {
  return validKeyEnv(seg.keyEnv) && Boolean(process.env[seg.keyEnv]);
}

const FAL_RUN = process.env.FAL_RUN_URL || 'https://fal.run';

/**
 * Roof masks with Meta SAM 3 on fal.ai (text prompt, e.g. "roof"). Returns one black-and-white mask per roof
 * found, as data URLs; the browser merges them.
 */
export async function segmentRoof(seg: SegmentationSettings, image: string): Promise<string[]> {
  const apiKey = process.env[seg.keyEnv];
  if (!apiKey) throw new Error(`${seg.keyEnv} is not set`);
  const res = await fetch(`${FAL_RUN}/fal-ai/sam-3/image`, {
    method: 'POST',
    headers: { Authorization: `Key ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: image,
      prompt: seg.prompt || 'roof',
      apply_mask: false,
      sync_mode: true,
      output_format: 'png',
      return_multiple_masks: true,
      max_masks: 8,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`fal.ai SAM 3 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { masks?: { url?: string }[] };
  const urls = (data.masks ?? []).map((m) => m.url).filter((u): u is string => Boolean(u));
  return Promise.all(urls.map((u) => (u.startsWith('data:') ? u : urlToDataUrl(u))));
}

export function defaultAiSettings(): AiSettings {
  const providers: ProviderConfig[] = [
    { id: 'gemini', label: 'Google Gemini – Nano Banana 2.1', type: 'gemini', model: 'gemini-nano-banana-2.1', keyEnv: 'GEMINI_API_KEY' },
    { id: 'openai', label: 'OpenAI – GPT Image', type: 'openai', model: 'gpt-image-1', keyEnv: 'OPENAI_API_KEY' },
    { id: 'bfl', label: 'Black Forest Labs – FLUX.2 Pro', type: 'bfl', model: 'flux-2-pro', keyEnv: 'BFL_API_KEY' },
    { id: 'fal', label: 'fal.ai – Nano Banana Pro Edit', type: 'fal', model: 'fal-ai/nano-banana-pro/edit', keyEnv: 'FAL_KEY' },
    { id: 'kie', label: 'kie.ai – Nano Banana Edit', type: 'kie', model: 'google/nano-banana-edit', keyEnv: 'KIE_API_KEY' },
    { id: 'replicate', label: 'Replicate – FLUX.1 Kontext Pro', type: 'replicate', model: 'black-forest-labs/flux-kontext-pro', keyEnv: 'REPLICATE_API_TOKEN' },
    { id: 'demo', label: 'Demo – returns the photo unchanged', type: 'demo', model: '', keyEnv: '' },
  ];
  // Before the admin saves a choice, keep the old behaviour: AI_PROVIDER, else the first provider with a key.
  const forced = providers.find((p) => p.type === process.env.AI_PROVIDER);
  const active = forced ?? providers.find((p) => p.type !== 'demo' && hasKey(p)) ?? providers[providers.length - 1];
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    include: { productData: true, specs: true, productPhotos: true, depthMap: true, roofMask: true },
    maxProductPhotos: 3,
    variants: 3,
    showEdgeMaps: true,
    segmentation: defaultSegmentation(),
    depthEstimation: defaultDepth(),
    measurement: defaultMeasurement(),
    activeProvider: active.id,
    providers,
  };
}

function splitDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Invalid data URL');
  return { mimeType: match[1], data: match[2] };
}

/** Runs one call per prompt in parallel; fails only when every call failed. */
async function allVariants(prompts: string[], once: (prompt: string) => Promise<string | null>): Promise<string[]> {
  const results = await Promise.allSettled(prompts.map(once));
  const images = results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
  const firstError = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  if (images.length === 0 && firstError) throw firstError.reason;
  return images;
}

/** Polls `check` until it returns a value, or throws after `timeoutMs`. */
async function poll<T>(check: () => Promise<T | undefined>, label: string, intervalMs = 1500, timeoutMs = 5 * 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const done = await check();
    if (done !== undefined) return done;
    if (Date.now() > deadline) throw new Error(`${label} timed out`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Downloads a result image and inlines it, so the browser can share/download it without CORS issues. */
async function urlToDataUrl(url: string, headers?: Record<string, string>): Promise<string> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Downloading the result failed: ${res.status}`);
  const type = res.headers.get('content-type') || 'image/jpeg';
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

/** Pixel size of a JPEG or PNG data URL (for models that need an aspect ratio). */
export function imageSize(dataUrl: string): { width: number; height: number } | null {
  const buf = Buffer.from(splitDataUrl(dataUrl).data, 'base64');
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

/** "W:H" aspect ratio of the photo, clamped to what FLUX Kontext accepts (3:7 to 7:3). */
function aspectRatio(dataUrl: string): string {
  const size = imageSize(dataUrl);
  if (!size) return '1:1';
  const r = Math.min(7 / 3, Math.max(3 / 7, size.width / size.height));
  return r >= 1 ? `${Math.round(r * 100)}:100` : `100:${Math.round(100 / r)}`;
}

/** Krea 3 output size: the photo's proportions, at most ~4.2 MP, 256–3200 px per side, multiples of 16. */
function kreaSize(dataUrl: string): { width: number; height: number } | null {
  const size = imageSize(dataUrl);
  if (!size) return null;
  const scale = Math.min(1, Math.sqrt(4_100_000 / (size.width * size.height)), 3200 / Math.max(size.width, size.height));
  const fit = (n: number) => Math.min(3200, Math.max(256, Math.round((n * scale) / 16) * 16));
  return { width: fit(size.width), height: fit(size.height) };
}

// ---------------------------------------------------------------------------------------------
// Google Gemini image editing (Nano Banana)
// ---------------------------------------------------------------------------------------------

const GEMINI_FALLBACKS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

function geminiProvider(cfg: ProviderConfig, apiKey: string): Provider {
  const ai = new GoogleGenAI({ apiKey });
  // Older image models are tried only when the configured one doesn't exist for this key.
  const models = [cfg.model, ...GEMINI_FALLBACKS.filter((m) => m !== cfg.model)];
  let workingModel: string | null = null;

  return {
    name: cfg.label,
    generate: ({ images, prompts }) =>
      allVariants(prompts, async (prompt) => {
        const parts: any[] = images.map((img) => ({ inlineData: splitDataUrl(img) }));
        parts.push({ text: prompt });
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
            if (!/not found|404|not supported/i.test(String(err?.message))) throw err;
          }
        }
        throw lastErr;
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// OpenAI image edits (GPT Image): several input images, first one is the photo to edit
// ---------------------------------------------------------------------------------------------

function openaiProvider(cfg: ProviderConfig, apiKey: string): Provider {
  return {
    name: cfg.label,
    generate: ({ images, prompts }) =>
      allVariants(prompts, async (prompt) => {
        const form = new FormData();
        form.append('model', cfg.model);
        form.append('prompt', prompt);
        form.append('n', '1');
        form.append('size', 'auto');
        images.forEach((img, i) => {
          const { mimeType, data } = splitDataUrl(img);
          form.append('image[]', new Blob([Buffer.from(data, 'base64')], { type: mimeType }), `image-${i + 1}.${mimeType.split('/')[1]}`);
        });
        const res = await fetch('https://api.openai.com/v1/images/edits', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        });
        if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
        const out = (await res.json()).data?.[0];
        if (out?.b64_json) return `data:image/png;base64,${out.b64_json}`;
        return out?.url ? urlToDataUrl(out.url) : null;
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// Black Forest Labs (api.bfl.ai): FLUX.2 takes input_image + input_image_2..8, Kontext one image
// ---------------------------------------------------------------------------------------------

/** Overridable for regional endpoints (e.g. https://api.eu.bfl.ai) and tests. */
const BFL_API = process.env.BFL_API_URL || 'https://api.bfl.ai';

function bflProvider(cfg: ProviderConfig, apiKey: string): Provider {
  const headers = { 'x-key': apiKey, accept: 'application/json' };
  return {
    name: cfg.label,
    generate: ({ images, prompts }) =>
      allVariants(prompts, async (prompt) => {
        const body: Record<string, unknown> = {
          prompt,
          output_format: 'jpeg',
          safety_tolerance: 2,
          seed: Math.floor(Math.random() * 1e9),
        };
        images.forEach((img, i) => (body[i === 0 ? 'input_image' : `input_image_${i + 1}`] = splitDataUrl(img).data));
        if (/kontext/i.test(cfg.model)) body.aspect_ratio = aspectRatio(images[0]);
        const res = await fetch(`${BFL_API}/v1/${cfg.model}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`BFL error: ${res.status} ${await res.text()}`);
        const { polling_url: pollingUrl, id } = await res.json();
        const url = pollingUrl || `${BFL_API}/v1/get_result?id=${id}`;
        const sample = await poll(async () => {
          const r = await (await fetch(url, { headers })).json();
          if (r.status === 'Ready') return r.result?.sample as string;
          if (['Error', 'Failed', 'Content Moderated', 'Request Moderated', 'Task not found'].includes(r.status)) {
            throw new Error(`BFL request ${r.status}: ${JSON.stringify(r.details ?? r.result ?? '')}`);
          }
          return undefined;
        }, 'BFL request', 1000);
        return urlToDataUrl(sample); // signed URL, valid for 10 minutes
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// fal.ai queue API: image_urls (multi-image edit models) or image_url, as data URIs
// ---------------------------------------------------------------------------------------------

const FAL_QUEUE = process.env.FAL_QUEUE_URL || 'https://queue.fal.run';

function falProvider(cfg: ProviderConfig, apiKey: string): Provider {
  const headers = { Authorization: `Key ${apiKey}` };
  const multi = imageLimitFor(cfg) > 1;
  // Krea 3 is krea/v3/... on fal.ai; fal-ai/krea/v3/... answers "Path /v3/edit not found".
  const model = cfg.model.replace(/^fal-ai\/krea\/v3\//i, 'krea/v3/');
  return {
    name: cfg.label,
    generate: ({ images, prompts }) =>
      allVariants(prompts, async (prompt) => {
        const input: Record<string, unknown> = { prompt, num_images: 1, output_format: 'jpeg' };
        // Multi-image models take image_urls; also send image_url (the house photo) for models that read only that.
        if (multi) input.image_urls = images;
        input.image_url = images[0];
        // Krea picks its own output size unless told; keep the house photo's size and proportions.
        if (/krea/i.test(cfg.model)) {
          const size = kreaSize(images[0]);
          if (size) input.image_size = size;
        }
        const res = await fetch(`${FAL_QUEUE}/${model}`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (!res.ok) throw new Error(`fal.ai error: ${res.status} ${await res.text()}`);
        const job = await res.json();
        await poll(async () => {
          const st = await (await fetch(job.status_url, { headers })).json();
          if (st.status === 'COMPLETED') {
            if (st.error) throw new Error(`fal.ai request failed: ${st.error}`);
            return true;
          }
          return undefined;
        }, 'fal.ai request');
        const out = await (await fetch(job.response_url, { headers })).json();
        const url = out.images?.[0]?.url ?? out.image?.url;
        if (!url) throw new Error(`fal.ai returned no image: ${JSON.stringify(out).slice(0, 300)}`);
        return url.startsWith('data:') ? url : urlToDataUrl(url);
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// kie.ai: upload the images (they need URLs), create a task, poll for the result
// ---------------------------------------------------------------------------------------------

const KIE_API = process.env.KIE_API_URL || 'https://api.kie.ai/api/v1';

function kieProvider(cfg: ProviderConfig, apiKey: string): Provider {
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const kie = async (path: string, init?: RequestInit) => {
    const res = await fetch(`${KIE_API}${path}`, { ...init, headers });
    const body = await res.json().catch(() => ({}));
    // kie.ai answers HTTP 200 even for errors; the real status is in `code`.
    if (!res.ok || (body.code && body.code !== 200)) throw new Error(`kie.ai error: ${body.code ?? res.status} ${body.msg ?? ''}`);
    return body.data;
  };

  return {
    name: cfg.label,
    async generate({ images, prompts }) {
      const urls = await Promise.all(
        images.map(async (img, i) => {
          const data = await kie('/file-base64-upload', {
            method: 'POST',
            body: JSON.stringify({ base64Data: img, uploadPath: 'roof-visualizer', fileName: `${Date.now().toString(36)}-${i}.${splitDataUrl(img).mimeType.split('/')[1]}` }),
          });
          return data.downloadUrl as string;
        }),
      );
      return allVariants(prompts, async (prompt) => {
        const field = /nano-banana-2|nano-banana-pro/i.test(cfg.model) ? 'image_input' : 'image_urls';
        const { taskId } = await kie('/jobs/createTask', {
          method: 'POST',
          body: JSON.stringify({ model: cfg.model, input: { prompt, [field]: urls, output_format: 'jpeg', aspect_ratio: 'auto' } }),
        });
        const result = await poll(async () => {
          const task = await kie(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
          if (task.state === 'success') return JSON.parse(task.resultJson || '{}').resultUrls?.[0] as string;
          if (task.state === 'fail') throw new Error(`kie.ai task failed: ${task.failCode ?? ''} ${task.failMsg ?? ''}`);
          return undefined;
        }, 'kie.ai task', 2000);
        if (!result) throw new Error('kie.ai returned no image');
        return urlToDataUrl(result);
      });
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Replicate (e.g. FLUX.1 Kontext): takes the house photo and the text prompt only
// ---------------------------------------------------------------------------------------------

const REPLICATE_API = 'https://api.replicate.com/v1';

function replicateProvider(cfg: ProviderConfig, token: string): Provider {
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
    let res = await fetch(`${REPLICATE_API}/models/${cfg.model}/predictions`, {
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
    return urlToDataUrl(Array.isArray(prediction.output) ? prediction.output[0] : prediction.output);
  }

  return {
    name: cfg.label,
    async generate({ images, prompts }) {
      const imageUrl = await upload(images[0]);
      return allVariants(prompts, (prompt) =>
        predict({
          prompt,
          input_image: imageUrl,
          aspect_ratio: 'match_input_image',
          output_format: 'jpg',
          seed: Math.floor(Math.random() * 1e9),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Demo: no API key needed; returns the photo so the whole app can be tried.
// ---------------------------------------------------------------------------------------------

function demoProvider(cfg: ProviderConfig): Provider {
  return {
    name: cfg.label,
    async generate({ images, prompts }) {
      await new Promise((r) => setTimeout(r, 4000));
      return prompts.map(() => images[0]);
    },
  };
}

/** Builds the provider for a config. Throws when its API key isn't set on the server. */
export function createProvider(cfg: ProviderConfig): Provider {
  if (cfg.type === 'demo') return demoProvider(cfg);
  if (!hasKey(cfg)) throw Object.assign(new Error(`API key missing: set ${cfg.keyEnv} on the server`), { code: 'unavailable' });
  const key = process.env[cfg.keyEnv]!;
  switch (cfg.type) {
    case 'gemini':
      return geminiProvider(cfg, key);
    case 'openai':
      return openaiProvider(cfg, key);
    case 'bfl':
      return bflProvider(cfg, key);
    case 'fal':
      return falProvider(cfg, key);
    case 'kie':
      return kieProvider(cfg, key);
    case 'replicate':
      return replicateProvider(cfg, key);
  }
}
