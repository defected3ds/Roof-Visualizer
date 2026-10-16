import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { githubConfig } from './server/github';
import {
  deleteProduct,
  ensureImage,
  getCategory,
  getProduct,
  getTexts,
  IMAGE_URL_PREFIX,
  imageDir,
  listCategories,
  listProducts,
  referenceImages,
  saveCategories,
  saveProduct,
  saveTexts,
  siteDir,
  SITE_URL_PREFIX,
  syncFromGitHub,
} from './server/store';
import { pickProvider } from './server/providers';
import type { Category, GenerateBody, ProductInput, Texts } from './src/types';

const MAX_VARIANTS = 4;
// Generations allowed per visitor IP per hour (each generation is several paid model calls).
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR) || 20;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= RATE_LIMIT) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function sameSecret(given: string | undefined, expected: string): boolean {
  const a = crypto.createHash('sha256').update(given ?? '').digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

async function startServer() {
  await syncFromGitHub();
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const provider = pickProvider();

  const accessCode = process.env.APP_PASSWORD || '';
  const adminPassword = process.env.ADMIN_PASSWORD || '';
  const hasAccess = (req: express.Request) => !accessCode || sameSecret(req.get('x-access-code'), accessCode);

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '40mb' }));
  app.use(IMAGE_URL_PREFIX, express.static(imageDir, { maxAge: '7d', immutable: true }));
  // Photos added after the last deploy are fetched from GitHub on first request.
  app.use(IMAGE_URL_PREFIX, async (req, res, next) => {
    const file = await ensureImage(IMAGE_URL_PREFIX + req.path.replace(/^\//, ''));
    if (!file) return next();
    res.set('Cache-Control', 'public, max-age=604800, immutable').sendFile(file);
  });
  app.use(IMAGE_URL_PREFIX, (_req, res) => res.status(404).end());
  app.use(SITE_URL_PREFIX, express.static(siteDir, { maxAge: '7d', immutable: true }));
  app.use(SITE_URL_PREFIX, async (req, res, next) => {
    const file = await ensureImage(SITE_URL_PREFIX + req.path.replace(/^\//, ''));
    if (!file) return next();
    res.set('Cache-Control', 'public, max-age=604800, immutable').sendFile(file);
  });
  app.use(SITE_URL_PREFIX, (_req, res) => res.status(404).end());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: provider.name, locked: Boolean(accessCode) });
  });

  // Lets the app check a code before showing the editor.
  app.post('/api/unlock', (req, res) => {
    if (hasAccess(req)) return res.json({ ok: true });
    res.status(401).json({ error: 'Wrong access code.' });
  });

  // Texts are public: the sign-in screen needs them before the visitor has a code.
  app.get('/api/texts', (_req, res) => res.json(getTexts()));

  app.get('/api/catalog', (req, res) => {
    const isAdmin = Boolean(adminPassword) && sameSecret(req.get('x-admin-password'), adminPassword);
    if (!hasAccess(req) && !isAdmin) return res.status(401).json({ error: 'Wrong or missing access code.', locked: true });
    res.json({ categories: listCategories(), products: listProducts() });
  });

  // ---- Product admin (/admin), protected by ADMIN_PASSWORD -------------------------------
  const admin = express.Router();
  admin.use((req, res, next) => {
    if (!adminPassword) {
      return res.status(503).json({ error: 'Product admin is switched off. Set ADMIN_PASSWORD on the server to use it.' });
    }
    if (!sameSecret(req.get('x-admin-password'), adminPassword)) {
      return res.status(401).json({ error: 'Wrong admin password.' });
    }
    next();
  });
  admin.post('/login', (_req, res) => res.json({ ok: true, githubSync: Boolean(githubConfig()) }));
  admin.post('/products', async (req, res) => {
    try {
      res.json(await saveProduct(req.body as ProductInput));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  admin.delete('/products/:id', async (req, res) => {
    try {
      res.json(await deleteProduct(req.params.id));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  admin.put('/categories', async (req, res) => {
    try {
      res.json(await saveCategories(req.body as Partial<Category>[]));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  admin.put('/texts', async (req, res) => {
    try {
      res.json(await saveTexts(req.body as Texts));
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  app.use('/api/admin', admin);

  app.post('/api/generate', async (req, res) => {
    if (!hasAccess(req)) {
      return res.status(401).json({ error: 'Wrong or missing access code.', locked: true });
    }
    if (rateLimited(req.ip ?? 'unknown')) {
      return res.status(429).json({ code: 'limit', error: `Limit reached (${RATE_LIMIT} generations per hour). Try again later.` });
    }
    const body = req.body as Partial<GenerateBody>;
    const product = body.productId ? getProduct(body.productId) : undefined;
    if (!body.image?.startsWith('data:image/') || !product) {
      return res.status(400).json({ error: 'Expected { image: dataURL, productId } with a known product' });
    }
    const count = Math.min(Math.max(Number(body.count) || 3, 1), MAX_VARIANTS);
    const photos = await referenceImages(product);
    const swatch = body.swatch?.startsWith('data:image/') ? [body.swatch] : [];
    const started = Date.now();
    try {
      const images = await provider.generate({
        image: body.image,
        product,
        category: getCategory(product.category),
        references: photos.length ? photos : swatch,
        photoReferences: photos.length > 0,
        count,
      });
      if (images.length === 0) {
        return res.status(502).json({ error: 'The model returned no images. Try again or pick another photo.' });
      }
      console.log(`[generate] ${provider.name} "${product.name}" (${photos.length} product photos) -> ${images.length} images in ${Date.now() - started}ms`);
      res.json({ images, provider: provider.name });
    } catch (err: any) {
      console.error('[generate] failed:', err);
      res.status(500).json({ error: err?.message || 'Generation failed' });
    }
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Roof Visualizer running on http://localhost:${PORT} (provider: ${provider.name})`);
  });
}

startServer();
