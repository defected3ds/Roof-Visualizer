import fs from 'fs';
import path from 'path';
import { commitFiles, githubConfig, type FileChange } from './github';
import type { Category, Product, ProductInput } from '../src/types';

const ROOT = process.cwd();
const CATALOG = 'data/products.json';
const IMAGE_DIR = 'data/product-images';
const CATEGORIES: Category[] = ['Tile', 'Shingles', 'Slate', 'Shake', 'Metal'];
const MAX_IMAGES = 6;
/** Product photos sent to the model with each generation. */
export const MAX_REFERENCES = 3;

export const IMAGE_URL_PREFIX = '/product-images/';
export const imageDir = path.join(ROOT, IMAGE_DIR);

function readCatalog(): Product[] {
  return JSON.parse(fs.readFileSync(path.join(ROOT, CATALOG), 'utf8'));
}

let products: Product[] = readCatalog();
// Saves run one after another so concurrent edits can't interleave commits.
let queue: Promise<unknown> = Promise.resolve();

export const listProducts = () => products;
export const getProduct = (id: string) => products.find((p) => p.id === id);

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'product'
  );
}

function urlToRepoPath(url: string) {
  return path.posix.join(IMAGE_DIR, url.slice(IMAGE_URL_PREFIX.length));
}

/** Product photos as data URLs, for sending to the model. */
export function referenceImages(product: Product): string[] {
  return product.images.slice(0, MAX_REFERENCES).flatMap((url) => {
    const file = path.join(ROOT, urlToRepoPath(url));
    if (!fs.existsSync(file)) return [];
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    return [`data:${mime};base64,${fs.readFileSync(file).toString('base64')}`];
  });
}

export interface SaveResult {
  product?: Product;
  /** True when the change was committed to GitHub and will survive a redeploy. */
  synced: boolean;
  warning?: string;
}

async function persist(next: Product[], changes: FileChange[], message: string): Promise<SaveResult> {
  const json = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  changes.push({ path: CATALOG, content: json });

  // Write locally first so the running app shows the change immediately.
  for (const { path: rel, content } of changes) {
    const abs = path.join(ROOT, rel);
    if (content === null) fs.rmSync(abs, { force: true });
    else {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
  }
  products = next;

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
    console.error('[products] GitHub sync failed:', err);
    return { synced: false, warning: `Saved, but copying to GitHub failed: ${err.message}` };
  }
}

function validate(input: ProductInput) {
  if (!input.name?.trim()) throw new Error('Name is required');
  if (!CATEGORIES.includes(input.category)) throw new Error('Choose a category');
  if (!input.description?.trim()) throw new Error('Describe the product for the AI');
  if ((input.images?.length ?? 0) > MAX_IMAGES) throw new Error(`At most ${MAX_IMAGES} photos per product`);
}

export function saveProduct(input: ProductInput): Promise<SaveResult> {
  const run = async () => {
    validate(input);
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
      images,
      ...(existing?.swatch ? { swatch: existing.swatch } : {}),
    };
    const next = existing ? products.map((p) => (p.id === id ? product : p)) : [...products, product];
    const result = await persist(next, changes, `${existing ? 'Update' : 'Add'} product "${product.name}"`);
    return { ...result, product };
  };
  const job = queue.then(run, run);
  queue = job.catch(() => {});
  return job;
}

export function deleteProduct(id: string): Promise<SaveResult> {
  const run = async () => {
    const existing = getProduct(id);
    if (!existing) throw new Error('Product not found');
    const changes: FileChange[] = existing.images.map((url) => ({ path: urlToRepoPath(url), content: null }));
    return persist(
      products.filter((p) => p.id !== id),
      changes,
      `Delete product "${existing.name}"`,
    );
  };
  const job = queue.then(run, run);
  queue = job.catch(() => {});
  return job;
}
