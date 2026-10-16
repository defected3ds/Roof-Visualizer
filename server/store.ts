import fs from 'fs';
import path from 'path';
import { commitFiles, githubConfig, readRepoFile, type FileChange } from './github';
import { DEFAULT_TEXTS, IMAGE_TEXT_KEYS } from '../src/texts';
import { defaultAiSettings, validKeyEnv, PROVIDER_TYPES } from './providers';
import type { AiSettings, Category, DepthSettings, Product, ProductInput, ProviderConfig, SegmentationSettings, Spec, Texts } from '../src/types';

/**
 * Catalog data (categories, products, product photos, app texts) lives in data/ in the repo.
 * Admin changes are written to disk and, with GITHUB_TOKEN, committed back to the repo.
 */
const ROOT = process.cwd();
const FILES = {
  categories: 'data/categories.json',
  products: 'data/products.json',
  texts: 'data/texts.json',
  ai: 'data/ai.json',
};
const IMAGE_DIR = 'data/product-images';
const MAX_IMAGES = 6;
const MAX_SPECS = 40;
/** Product photos sent to the model with each generation. */
export const MAX_REFERENCES = 3;

export const IMAGE_URL_PREFIX = '/product-images/';
export const imageDir = path.join(ROOT, IMAGE_DIR);
/** Uploaded site photos (e.g. the start screen photo), served at /site/. */
const SITE_DIR = 'data/site';
export const SITE_URL_PREFIX = '/site/';
export const siteDir = path.join(ROOT, SITE_DIR);

function readJson<T>(rel: string, fallback: T): T {
  const file = path.join(ROOT, rel);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

let categories: Category[] = [];
let products: Product[] = [];
let texts: Texts = {};
/** Saved AI settings, or null to use the defaults (see providers.ts). */
let aiSettings: AiSettings | null = null;

function load() {
  categories = readJson(FILES.categories, []);
  // Older catalogs stored the category name ("Tile") instead of its id ("tile").
  const categoryId = (value: string) =>
    categories.find((c) => c.id === value || c.name.toLowerCase() === value?.toLowerCase())?.id ?? value;
  products = readJson<Product[]>(FILES.products, []).map((p) => ({ ...p, category: categoryId(p.category), specs: p.specs ?? [] }));
  texts = readJson(FILES.texts, {});
  aiSettings = readJson<AiSettings | null>(FILES.ai, null);
}
load();

/**
 * Pulls the latest catalog from GitHub at startup. Hosts like Render restart from the last
 * deployed commit, which can be older than the latest admin save; this makes saves stick
 * even when no redeploy happened. Product photos are fetched on demand (see ensureImage).
 */
export async function syncFromGitHub() {
  if (!githubConfig()) return;
  try {
    // Download everything first and only replace the local copy when all files look valid.
    const downloads: [string, Buffer][] = [];
    for (const [name, rel] of Object.entries(FILES)) {
      const content = await readRepoFile(rel);
      if (!content) continue;
      const parsed = JSON.parse(content.toString('utf8'));
      const valid =
        name === 'texts' || name === 'ai' ? parsed && typeof parsed === 'object' && !Array.isArray(parsed) : Array.isArray(parsed);
      if (!valid) throw new Error(`${rel} on GitHub is not a valid ${name} file`);
      downloads.push([rel, content]);
    }
    for (const [rel, content] of downloads) fs.writeFileSync(path.join(ROOT, rel), content);
    load();
    console.log(`[store] Loaded catalog from GitHub: ${categories.length} categories, ${products.length} products`);
  } catch (err) {
    console.error('[store] Could not load the catalog from GitHub, using the deployed copy:', err);
  }
}

/** Makes sure a product or site photo is on disk, downloading it from GitHub if this server doesn't have it yet. */
export async function ensureImage(url: string): Promise<string | null> {
  if (url.includes('..')) return null;
  const rel = url.startsWith(IMAGE_URL_PREFIX)
    ? urlToRepoPath(url)
    : url.startsWith(SITE_URL_PREFIX)
      ? path.posix.join(SITE_DIR, url.slice(SITE_URL_PREFIX.length))
      : null;
  if (!rel) return null;
  const abs = path.join(ROOT, rel);
  if (fs.existsSync(abs)) return abs;
  const content = await readRepoFile(rel).catch(() => null);
  if (!content) return null;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

// Saves run one after another so concurrent edits can't interleave commits.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(run: () => Promise<T>): Promise<T> {
  const job = queue.then(run, run);
  queue = job.catch(() => {});
  return job;
}

export const listCategories = () => categories;
export const listProducts = () => products;
export const getTexts = () => texts;
export const getProduct = (id: string) => products.find((p) => p.id === id);
export const getCategory = (id: string) => categories.find((c) => c.id === id);

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'item'
  );
}

function urlToRepoPath(url: string) {
  return path.posix.join(IMAGE_DIR, url.slice(IMAGE_URL_PREFIX.length));
}

const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');

/** Product photos as data URLs, for sending to the model. */
export async function referenceImages(product: Product): Promise<string[]> {
  const files = await Promise.all(product.images.slice(0, MAX_REFERENCES).map(ensureImage));
  return files.flatMap((file) => {
    if (!file) return [];
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return [`data:${mime};base64,${fs.readFileSync(file).toString('base64')}`];
  });
}

export interface SaveResult {
  /** True when the change was committed to GitHub and will survive a redeploy. */
  synced: boolean;
  warning?: string;
}

async function persist(changes: FileChange[], message: string): Promise<SaveResult> {
  // Write locally first so the running app shows the change immediately.
  for (const { path: rel, content } of changes) {
    const abs = path.join(ROOT, rel);
    if (content === null) fs.rmSync(abs, { force: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  if (!githubConfig()) {
    return {
      synced: false,
      warning: 'Saved on this server only. Add GITHUB_TOKEN so changes are kept after the app restarts or redeploys.',
    };
  }
  try {
    await commitFiles(changes, message);
    return { synced: true };
  } catch (err: any) {
    console.error('[store] GitHub sync failed:', err);
    return { synced: false, warning: `Saved, but copying to GitHub failed: ${err.message}` };
  }
}

// ---- Products -------------------------------------------------------------------------------

function cleanSpecs(specs: Spec[] | undefined): Spec[] {
  const rows = (specs ?? [])
    .map((s) => ({ label: String(s.label ?? '').trim(), value: String(s.value ?? '').trim() }))
    .filter((s) => s.label || s.value);
  if (rows.length > MAX_SPECS) throw new Error(`At most ${MAX_SPECS} technical data rows`);
  return rows;
}

export function saveProduct(input: ProductInput): Promise<SaveResult & { product: Product }> {
  return serialized(async () => {
    if (!input.name?.trim()) throw new Error('Name is required');
    if (!getCategory(input.category)) throw new Error('Choose a category');
    if (!input.description?.trim()) throw new Error('Describe the product for the AI');
    if ((input.images?.length ?? 0) > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} photos per product`);
    const existing = input.id ? getProduct(input.id) : undefined;
    if (input.id && !existing) throw new Error('Product not found');

    const id = existing?.id ?? `${slug(input.name)}-${Date.now().toString(36)}`;
    const changes: FileChange[] = [];
    const images: string[] = [];
    input.images.forEach((img, i) => {
      if (img.startsWith(IMAGE_URL_PREFIX)) {
        if (existing?.images.includes(img)) images.push(img);
        return;
      }
      const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/s.exec(img);
      if (!match) throw new Error('Photos must be JPEG, PNG or WebP');
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const url = `${IMAGE_URL_PREFIX}${id}/${Date.now().toString(36)}-${i}.${ext}`;
      changes.push({ path: urlToRepoPath(url), content: Buffer.from(match[2], 'base64') });
      images.push(url);
    });
    for (const old of existing?.images ?? []) {
      if (!images.includes(old)) changes.push({ path: urlToRepoPath(old), content: null });
    }

    const product: Product = {
      id,
      name: input.name.trim(),
      category: input.category,
      brand: input.brand?.trim() ?? '',
      description: input.description.trim(),
      specs: cleanSpecs(input.specs),
      images,
      ...(existing?.swatch ? { swatch: existing.swatch } : {}),
    };
    const next = existing ? products.map((p) => (p.id === id ? product : p)) : [...products, product];
    changes.push({ path: FILES.products, content: json(next) });
    const result = await persist(changes, `${existing ? 'Update' : 'Add'} product "${product.name}"`);
    products = next;
    return { ...result, product };
  });
}

export function deleteProduct(id: string): Promise<SaveResult> {
  return serialized(async () => {
    const existing = getProduct(id);
    if (!existing) throw new Error('Product not found');
    const next = products.filter((p) => p.id !== id);
    const changes: FileChange[] = existing.images.map((url) => ({ path: urlToRepoPath(url), content: null }));
    changes.push({ path: FILES.products, content: json(next) });
    const result = await persist(changes, `Delete product "${existing.name}"`);
    products = next;
    return result;
  });
}

// ---- Categories -----------------------------------------------------------------------------

/** Replaces the whole category list (adds, renames, reorders, deletes in one save). */
export function saveCategories(input: Partial<Category>[]): Promise<SaveResult & { categories: Category[] }> {
  return serialized(async () => {
    const seen = new Set<string>();
    const next: Category[] = input.map((c) => {
      const name = String(c.name ?? '').trim();
      if (!name) throw new Error('Every category needs a name');
      let id = c.id && getCategory(c.id) ? c.id : slug(name);
      while (seen.has(id) || (!c.id && getCategory(id))) id = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
      seen.add(id);
      return { id, name, description: String(c.description ?? '').trim() };
    });
    if (next.length === 0) throw new Error('Keep at least one category');
    const inUse = categories.filter((c) => !seen.has(c.id) && products.some((p) => p.category === c.id));
    if (inUse.length) {
      throw new Error(`"${inUse[0].name}" still has products. Move or delete them first.`);
    }
    const result = await persist([{ path: FILES.categories, content: json(next) }], 'Update categories');
    categories = next;
    return { ...result, categories };
  });
}

// ---- App texts ------------------------------------------------------------------------------

/**
 * Stores only texts that differ from the defaults, so improved defaults still reach untouched fields.
 * Photo fields (IMAGE_TEXT_KEYS) may carry a new upload as a data URL; it is saved under data/site/.
 */
export function saveTexts(input: Texts): Promise<SaveResult & { texts: Texts }> {
  return serialized(async () => {
    const next: Texts = {};
    const changes: FileChange[] = [];
    for (const [key, value] of Object.entries(input ?? {})) {
      if (!(key in DEFAULT_TEXTS)) continue;
      let text = String(value ?? '').trim();
      if (IMAGE_TEXT_KEYS.includes(key)) {
        const upload = /^data:image\/(jpeg|png|webp);base64,(.+)$/s.exec(text);
        if (upload) {
          const file = `${slug(key)}-${Date.now().toString(36)}.${upload[1] === 'jpeg' ? 'jpg' : upload[1]}`;
          changes.push({ path: path.posix.join(SITE_DIR, file), content: Buffer.from(upload[2], 'base64') });
          text = SITE_URL_PREFIX + file;
        } else if (text && !text.startsWith(SITE_URL_PREFIX) && text !== DEFAULT_TEXTS[key]) {
          throw new Error('Photos must be JPEG, PNG or WebP');
        }
        const old = texts[key];
        if (old?.startsWith(SITE_URL_PREFIX) && old !== text) {
          changes.push({ path: path.posix.join(SITE_DIR, old.slice(SITE_URL_PREFIX.length)), content: null });
        }
      }
      if (text && text !== DEFAULT_TEXTS[key]) next[key] = text;
    }
    changes.push({ path: FILES.texts, content: json(next) });
    const result = await persist(changes, 'Update app texts');
    texts = next;
    return { ...result, texts };
  });
}

// ---- AI settings ----------------------------------------------------------------------------

/** Saved settings merged over the defaults, so new options get sensible values. */
export function getAiSettings(): AiSettings {
  const defaults = defaultAiSettings();
  if (!aiSettings) return defaults;
  return {
    ...defaults,
    ...aiSettings,
    include: { ...defaults.include, ...aiSettings.include },
    segmentation: { ...defaults.segmentation, ...aiSettings.segmentation },
    depthEstimation: { ...defaults.depthEstimation, ...aiSettings.depthEstimation },
    providers: aiSettings.providers?.length ? aiSettings.providers : defaults.providers,
  };
}

function cleanProvider(p: Partial<ProviderConfig>, seen: Set<string>): ProviderConfig {
  const type = p.type && p.type in PROVIDER_TYPES ? p.type : null;
  if (!type) throw new Error('Choose an API type for every model');
  const label = String(p.label ?? '').trim() || PROVIDER_TYPES[type].label;
  let model = String(p.model ?? '').trim();
  // Krea 3 lives at krea/v3/... on fal.ai, not under fal-ai/ (that path answers "Path /v3/edit not found").
  if (type === 'fal') model = model.replace(/^fal-ai\/krea\/v3\//i, 'krea/v3/');
  if (type !== 'demo' && !model) throw new Error(`"${label}" needs a model name`);
  const keyEnv = type === 'demo' ? '' : String(p.keyEnv ?? '').trim().toUpperCase();
  if (type !== 'demo' && !validKeyEnv(keyEnv)) {
    throw new Error(`"${label}": the key variable must be a name like GEMINI_API_KEY (ending in KEY or TOKEN)`);
  }
  let id = String(p.id ?? '').trim() || slug(label);
  while (seen.has(id)) id = `${slug(label)}-${Math.random().toString(36).slice(2, 6)}`;
  seen.add(id);
  const systemPrompt = String(p.systemPrompt ?? '').trim().slice(0, 30000);
  return { id, label, type, model, keyEnv, ...(systemPrompt ? { systemPrompt } : {}) };
}

function cleanDepth(d: DepthSettings): DepthSettings {
  const tool = d.tool === 'marigold' ? 'marigold' : 'browser';
  const keyEnv = String(d.keyEnv ?? '').trim().toUpperCase() || 'FAL_API_KEY';
  if (tool === 'marigold' && !validKeyEnv(keyEnv)) {
    throw new Error('Depth map: the key variable must be a name like FAL_API_KEY (ending in KEY or TOKEN)');
  }
  const quality = d.quality === 'fast' || d.quality === 'best' ? d.quality : 'balanced';
  return { tool, keyEnv, quality };
}

function cleanSegmentation(s: SegmentationSettings): SegmentationSettings {
  const tool = s.tool === 'sam3' ? 'sam3' : 'clipseg';
  const keyEnv = String(s.keyEnv ?? '').trim().toUpperCase() || 'FAL_API_KEY';
  if (tool === 'sam3' && !validKeyEnv(keyEnv)) {
    throw new Error('Roof mask: the key variable must be a name like FAL_API_KEY (ending in KEY or TOKEN)');
  }
  const prompt = String(s.prompt ?? '').trim().slice(0, 100) || 'roof';
  return { tool, keyEnv, prompt };
}

export function saveAiSettings(input: Partial<AiSettings>): Promise<SaveResult & { settings: AiSettings }> {
  return serialized(async () => {
    const current = getAiSettings();
    const seen = new Set<string>();
    const providers = (input.providers ?? current.providers).map((p) => cleanProvider(p, seen));
    if (providers.length === 0) throw new Error('Keep at least one image model');
    const activeProvider = providers.some((p) => p.id === input.activeProvider) ? input.activeProvider! : providers[0].id;
    const clamp = (n: unknown, lo: number, hi: number, d: number) => Math.min(hi, Math.max(lo, Math.round(Number(n)) || d));
    const next: AiSettings = {
      systemPrompt: String(input.systemPrompt ?? current.systemPrompt).trim(),
      include: {
        productData: Boolean(input.include?.productData ?? current.include.productData),
        specs: Boolean(input.include?.specs ?? current.include.specs),
        productPhotos: Boolean(input.include?.productPhotos ?? current.include.productPhotos),
        depthMap: Boolean(input.include?.depthMap ?? current.include.depthMap),
        roofMask: Boolean(input.include?.roofMask ?? current.include.roofMask),
      },
      maxProductPhotos: clamp(input.maxProductPhotos ?? current.maxProductPhotos, 1, 3, 3),
      variants: clamp(input.variants ?? current.variants, 1, 4, 3),
      showEdgeMaps: Boolean(input.showEdgeMaps ?? current.showEdgeMaps),
      segmentation: cleanSegmentation({ ...current.segmentation, ...input.segmentation }),
      depthEstimation: cleanDepth({ ...current.depthEstimation, ...input.depthEstimation }),
      activeProvider,
      providers,
    };
    if (!next.systemPrompt) throw new Error('The system prompt cannot be empty');
    const result = await persist([{ path: FILES.ai, content: json(next) }], 'Update AI settings');
    aiSettings = next;
    return { ...result, settings: next };
  });
}
