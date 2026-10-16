import { GoogleGenAI } from '@google/genai';
import { DEFAULT_SYSTEM_PROMPT } from '../src/lib/prompt';
import type { AiSettings, ProviderConfig, ProviderType } from '../src/types';

/** What every image model receives: the ordered images (house photo first) and one prompt per variant. */
export interface ModelInput {
  images: string[];
  prompts: string[];
}

export interface Provider {
  name: string;
  generate(input: ModelInput): Promise<string[]>;
}

/** Which inputs each kind of API can use; shown in the admin. */
export const PROVIDER_TYPES: Record<ProviderType, { label: string; images: 'all' | 'photo-only' | 'none'; defaultModel: string; defaultKeyEnv: string }> = {
  gemini: { label: 'Google Gemini', images: 'all', defaultModel: 'gemini-nano-banana-2.1', defaultKeyEnv: 'GEMINI_API_KEY' },
  openai: { label: 'OpenAI Images', images: 'all', defaultModel: 'gpt-image-1', defaultKeyEnv: 'OPENAI_API_KEY' },
  replicate: { label: 'Replicate', images: 'photo-only', defaultModel: 'black-forest-labs/flux-kontext-pro', defaultKeyEnv: 'REPLICATE_API_TOKEN' },
  demo: { label: 'Demo (no AI)', images: 'none', defaultModel: '', defaultKeyEnv: '' },
};

/** Env variable names a provider may read its key from; never the app's own secrets. */
const KEY_ENV = /^[A-Z][A-Z0-9_]*(KEY|TOKEN)$/;
const RESERVED_ENV = new Set(['GITHUB_TOKEN']);

export function validKeyEnv(name: string) {
  return KEY_ENV.test(name) && !RESERVED_ENV.has(name);
}

export function hasKey(cfg: ProviderConfig): boolean {
  return cfg.type === 'demo' || (validKeyEnv(cfg.keyEnv) && Boolean(process.env[cfg.keyEnv]));
}

export function defaultAiSettings(): AiSettings {
  const providers: ProviderConfig[] = [
    { id: 'gemini', label: 'Google Gemini – Nano Banana 2.1', type: 'gemini', model: 'gemini-nano-banana-2.1', keyEnv: 'GEMINI_API_KEY' },
    { id: 'openai', label: 'OpenAI – GPT Image', type: 'openai', model: 'gpt-image-1', keyEnv: 'OPENAI_API_KEY' },
    { id: 'replicate', label: 'Replicate – FLUX.1 Kontext Pro', type: 'replicate', model: 'black-forest-labs/flux-kontext-pro', keyEnv: 'REPLICATE_API_TOKEN' },
    { id: 'demo', label: 'Demo – returns the photo unchanged', type: 'demo', model: '', keyEnv: '' },
  ];
  // Before the admin saves a choice, keep the old behaviour: AI_PROVIDER, else the first provider with a key.
  const forced = providers.find((p) => p.type === process.env.AI_PROVIDER);
  const active = forced ?? providers.find((p) => p.type !== 'demo' && hasKey(p)) ?? providers[3];
  return {
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    include: { productData: true, specs: true, productPhotos: true, depthMap: true, roofMask: true },
    maxProductPhotos: 3,
    variants: 3,
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
        return out?.b64_json ? `data:image/png;base64,${out.b64_json}` : null;
      }),
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
    const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    // Inline the result so the browser can share/download it without CORS issues.
    const img = await fetch(url);
    const type = img.headers.get('content-type') || 'image/png';
    return `data:${type};base64,${Buffer.from(await img.arrayBuffer()).toString('base64')}`;
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
    case 'replicate':
      return replicateProvider(cfg, key);
  }
}
