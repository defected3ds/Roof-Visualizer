/**
 * Cost history: one record per API call (image generation, depth map, roof mask, admin tests) with an estimated
 * cost from an editable price table, plus small previews of the photo and the results.
 *
 * Records go to Supabase (a free Postgres database, through its REST API, no extra npm package) when SUPABASE_URL and
 * SUPABASE_SERVICE_KEY are set on the server; otherwise they are kept in memory only (lost at a restart).
 * Logging never breaks the app: every failure is caught and shown in Admin > Costs.
 */
import { imageSize } from './providers';
import { currentVisitor } from './visitor';
import type { AiSettings, PriceItem, ProviderConfig, UsageEvent } from '../src/types';

export function defaultPrices(): PriceItem[] {
  return [
    { id: 'gemini.image', label: 'Google Gemini (Nano Banana)', unit: 'result', price: 0.04, note: '$0.0336 per 1K image plus a small input charge' },
    { id: 'openai.image', label: 'OpenAI GPT Image 2.5 (Flare, Sunburst)', unit: 'result', price: 0.1, note: 'Billed by tokens; $0.05–0.15 is typical, check your usage page' },
    { id: 'krea.mp', label: 'Krea 3 on fal.ai', unit: 'megapixel', price: 0.025, note: 'Billed for the output and every attached image' },
    { id: 'flux2.out', label: 'FLUX.2 (bfl.ai), output', unit: 'megapixel', price: 0.03, note: 'First megapixel; later ones are cheaper' },
    { id: 'flux2.in', label: 'FLUX.2 (bfl.ai), input images', unit: 'megapixel', price: 0.015 },
    { id: 'other.image', label: 'Other image models (fal.ai, kie.ai, Replicate, GPT Image 1)', unit: 'result', price: 0.05, note: 'A rough default: check the provider price page' },
    { id: 'sam3.photo', label: 'Meta SAM 3 roof mask (fal.ai)', unit: 'photo', price: 0.005 },
    { id: 'marigold.second', label: 'Marigold depth map (fal.ai)', unit: 'compute second', price: 0.000575 },
    { id: 'depthpro.photo', label: 'Depth Pro measurement (Replicate)', unit: 'photo', price: 0.01, note: 'a guess: check the first call on your Replicate usage page' },
    { id: 'midas.photo', label: 'MiDaS depth map (fal.ai)', unit: 'photo', price: 0.002, note: 'fal.ai lists no price: a guess, check the model page' },
  ];
}

export const priceOf = (prices: PriceItem[], id: string) => prices.find((p) => p.id === id)?.price ?? defaultPrices().find((p) => p.id === id)?.price ?? 0;

const megapixels = (dataUrl: string) => {
  try {
    const s = imageSize(dataUrl);
    return s ? (s.width * s.height) / 1e6 : 1;
  } catch {
    return 1;
  }
};

/** Estimated cost of one generation: `results` pictures made from `images` (data URLs, house photo first). */
export function imageCost(prices: PriceItem[], cfg: Pick<ProviderConfig, 'type' | 'model'>, images: string[], results: number) {
  const inMP = images.reduce((sum, img) => sum + megapixels(img), 0);
  const outMP = images.length ? megapixels(images[0]) : 1;
  const model = cfg.model.toLowerCase();
  let cost: number;
  let basis: string;
  if (cfg.type === 'fal' && model.includes('krea')) {
    cost = results * (outMP + inMP) * priceOf(prices, 'krea.mp');
    basis = `${results} × (${outMP.toFixed(1)} MP out + ${inMP.toFixed(1)} MP in) × $${priceOf(prices, 'krea.mp')}`;
  } else if (cfg.type === 'bfl' && model.startsWith('flux-2')) {
    cost = results * (outMP * priceOf(prices, 'flux2.out') + inMP * priceOf(prices, 'flux2.in'));
    basis = `${results} × (${outMP.toFixed(1)} MP out + ${inMP.toFixed(1)} MP in)`;
  } else if (cfg.type === 'gemini') {
    cost = results * priceOf(prices, 'gemini.image');
    basis = `${results} × $${priceOf(prices, 'gemini.image')}`;
  } else if (cfg.type === 'openai' && model.includes('2.5')) {
    cost = results * priceOf(prices, 'openai.image');
    basis = `${results} × $${priceOf(prices, 'openai.image')}`;
  } else if (cfg.type === 'demo') {
    cost = 0;
    basis = 'demo mode, no AI';
  } else {
    cost = results * priceOf(prices, 'other.image');
    basis = `${results} × $${priceOf(prices, 'other.image')} (default)`;
  }
  return { cost, basis, imagesMP: Number(inMP.toFixed(2)) };
}

/** Price-table ids of the services the current AI settings use, so the admin can highlight them. */
export function activePriceIds(ai: AiSettings): string[] {
  const ids: string[] = [];
  const cfg = ai.providers.find((p) => p.id === ai.activeProvider);
  if (cfg) {
    const model = cfg.model.toLowerCase();
    if (cfg.type === 'fal' && model.includes('krea')) ids.push('krea.mp');
    else if (cfg.type === 'bfl' && model.startsWith('flux-2')) ids.push('flux2.out', 'flux2.in');
    else if (cfg.type === 'gemini') ids.push('gemini.image');
    else if (cfg.type === 'openai' && model.includes('2.5')) ids.push('openai.image');
    else if (cfg.type !== 'demo') ids.push('other.image');
  }
  if (ai.segmentation.tool === 'sam3') ids.push('sam3.photo');
  if (ai.depthEstimation.tool === 'marigold') ids.push('marigold.second');
  if (ai.depthEstimation.tool === 'midas') ids.push('midas.photo');
  if (ai.measurement.tool === 'depthpro') ids.push('depthpro.photo');
  return ids;
}

export function depthCost(prices: PriceItem[], tool: 'marigold' | 'midas' | 'browser', ms: number) {
  if (tool === 'marigold') return priceOf(prices, 'marigold.second') * (ms / 1000);
  if (tool === 'midas') return priceOf(prices, 'midas.photo');
  return 0;
}

export const roofMaskCost = (prices: PriceItem[]) => priceOf(prices, 'sam3.photo');
/** Depth Pro plus the SAM 3 calls the measurement made itself (roof and wall masks are reused when the browser already asked for them). */
export const measureCost = (prices: PriceItem[], samCalls = 4) => priceOf(prices, 'depthpro.photo') + samCalls * priceOf(prices, 'sam3.photo');

// ---- Storage ----------------------------------------------------------------------------------

const MEMORY_LIMIT = 500;
const memory: UsageEvent[] = [];
let nextId = 1;
let lastError = '';

const supabaseUrl = () => (process.env.SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const supabaseKey = () => process.env.SUPABASE_SERVICE_KEY || '';
const useSupabase = () => Boolean(supabaseUrl() && supabaseKey());

export const usageStorage = (): 'supabase' | 'memory' => (useSupabase() ? 'supabase' : 'memory');
export const usageLastError = () => lastError;

async function rest(pathAndQuery: string, init: RequestInit = {}, prefer?: string) {
  const res = await fetch(`${supabaseUrl()}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: supabaseKey(),
      // New sb_secret_ keys are not JWTs and must only go in apikey; old service_role keys are JWTs.
      ...(supabaseKey().startsWith('eyJ') ? { Authorization: `Bearer ${supabaseKey()}` } : {}),
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

/** Saves one record. Never throws. */
export async function recordUsage(event: Omit<UsageEvent, 'id' | 'created_at'>): Promise<void> {
  try {
    const visitor = await currentVisitor();
    if (visitor) event = { ...event, detail: { ...event.detail, visitor } };
    if (useSupabase()) {
      await rest('usage_events', { method: 'POST', body: JSON.stringify({ ...event, cost: Number(event.cost.toFixed(5)) }) }, 'return=minimal');
    } else {
      memory.unshift({ ...event, id: nextId++, created_at: new Date().toISOString() });
      memory.length = Math.min(memory.length, MEMORY_LIMIT);
    }
    lastError = '';
  } catch (err: any) {
    lastError = String(err?.message ?? err);
    console.error('[usage] could not record:', lastError);
  }
}

/** Adds small previews of the photo and the results to a generation's record. Never throws. */
export async function attachPreviews(generationId: string, previews: NonNullable<UsageEvent['previews']>): Promise<void> {
  try {
    if (useSupabase()) {
      await rest(`usage_events?generation_id=eq.${encodeURIComponent(generationId)}&kind=in.(image,test-image)`, {
        method: 'PATCH',
        body: JSON.stringify({ previews }),
      }, 'return=minimal');
    } else {
      const hit = memory.find((e) => e.generation_id === generationId && (e.kind === 'image' || e.kind === 'test-image'));
      if (hit) hit.previews = previews;
    }
  } catch (err: any) {
    lastError = String(err?.message ?? err);
    console.error('[usage] could not save previews:', lastError);
  }
}

/** Newest first. */
export async function listUsage(sinceDays: number | null, limit = 1500): Promise<UsageEvent[]> {
  const since = sinceDays ? new Date(Date.now() - sinceDays * 86_400_000).toISOString() : null;
  try {
    if (useSupabase()) {
      const filter = since ? `&created_at=gte.${encodeURIComponent(since)}` : '';
      const res = await rest(`usage_events?select=*&order=created_at.desc&limit=${limit}${filter}`);
      lastError = '';
      return (await res.json()) as UsageEvent[];
    }
    return memory.filter((e) => !since || e.created_at >= since).slice(0, limit);
  } catch (err: any) {
    lastError = String(err?.message ?? err);
    console.error('[usage] could not read:', lastError);
    return [];
  }
}

/** Removes previews older than the retention period (the costs stay) and records older than two years. Never throws. */
export async function purgeUsage(retentionDays: number): Promise<void> {
  const days = Math.max(1, Math.round(retentionDays) || 30);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  try {
    if (useSupabase()) {
      await rest(`usage_events?created_at=lt.${encodeURIComponent(cutoff)}&previews=not.is.null`, { method: 'PATCH', body: JSON.stringify({ previews: null }) }, 'return=minimal');
      const old = new Date(Date.now() - 730 * 86_400_000).toISOString();
      await rest(`usage_events?created_at=lt.${encodeURIComponent(old)}`, { method: 'DELETE' }, 'return=minimal');
    } else {
      for (const e of memory) if (e.created_at < cutoff) e.previews = null;
    }
  } catch (err: any) {
    lastError = String(err?.message ?? err);
    console.error('[usage] purge failed:', lastError);
  }
}
