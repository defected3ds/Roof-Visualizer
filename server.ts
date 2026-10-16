import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import path from 'path';
import { githubConfig } from './server/github';
import {
  deleteProduct,
  ensureImage,
  getAiSettings,
  getCategory,
  getProduct,
  getTexts,
  IMAGE_URL_PREFIX,
  imageDir,
  listCategories,
  listProducts,
  referenceImages,
  saveAiSettings,
  saveCategories,
  saveProduct,
  saveTexts,
  siteDir,
  SITE_URL_PREFIX,
  syncFromGitHub,
} from './server/store';
import { createProvider, hasKey, imageLimit, PROVIDER_TYPES, type Provider } from './server/providers';
import { buildFinalPrompt, type ImageRoles } from './src/lib/prompt';
import type { AiSettings, Category, GenerateBody, ProductInput, ProviderConfig, Texts } from './src/types';
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
  // The active image model comes from /admin > AI settings; providers are reused while their config is unchanged.
  const providerCache = new Map<string, Provider>();
  const activeConfig = (): ProviderConfig => {
    const ai = getAiSettings();
    return ai.providers.find((p) => p.id === ai.activeProvider) ?? ai.providers[0];
  };
  const providerFor = (cfg: ProviderConfig) => {
    const key = JSON.stringify(cfg);
    if (!providerCache.has(key)) providerCache.set(key, createProvider(cfg));
    return providerCache.get(key)!;
  };

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
    const cfg = activeConfig();
    const ai = getAiSettings();
    const usesImages = imageLimit(cfg) > 1;
    res.json({
      ok: true,
      provider: cfg.type,
      providerLabel: cfg.label,
      locked: Boolean(accessCode),
      // Which photo analyses the app should run (they're only useful when the model receives them).
      analysis: { depth: usesImages && ai.include.depthMap, mask: usesImages && ai.include.roofMask },
      // Line / edge maps on the loading screen (display only).
      edgeMaps: ai.showEdgeMaps,
    });
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
  admin.get('/ai', (_req, res) => {
    const settings = getAiSettings();
    res.json({
      settings,
      keyStatus: Object.fromEntries(settings.providers.map((p) => [p.id, hasKey(p)])),
      types: PROVIDER_TYPES,
    });
  });
  admin.put('/ai', async (req, res) => {
    try {
      const result = await saveAiSettings(req.body as Partial<AiSettings>);
      res.json({ ...result, keyStatus: Object.fromEntries(result.settings.providers.map((p) => [p.id, hasKey(p)])) });
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
    const ai = getAiSettings();
    const cfg = activeConfig();
    const dataUrl = (v?: string) => (v?.startsWith('data:image/') ? v : undefined);
    // Images in priority order, up to what the model accepts: house photo, depth map, roof mask, product photos.
    let room = imageLimit(cfg) - 1;
    const take = <T,>(v: T | undefined) => (v && room > 0 ? (room--, v) : undefined);
    const depth = ai.include.depthMap ? take(dataUrl(body.depth)) : undefined;
    const mask = ai.include.roofMask ? take(dataUrl(body.mask)) : undefined;
    const allPhotos = ai.include.productPhotos ? (await referenceImages(product)).slice(0, ai.maxProductPhotos) : [];
    const photos = allPhotos.slice(0, Math.max(0, room));
    room -= photos.length;
    const swatch = ai.include.productPhotos && !allPhotos.length ? take(dataUrl(body.swatch)) : undefined;
    const roles: ImageRoles = { depth: Boolean(depth), mask: Boolean(mask), productPhotos: photos.length, swatch: Boolean(swatch) };
    const images = [body.image, depth, mask, ...photos, swatch].filter((x): x is string => Boolean(x));
    const category = getCategory(product.category);
    const prompts = Array.from({ length: ai.variants }, (_, v) => buildFinalPrompt(ai, product, category, roles, v));

    const started = Date.now();
    try {
      const results = await providerFor(cfg).generate({ images, prompts });
      if (results.length === 0) {
        return res.status(502).json({ error: 'The model returned no images. Try again or pick another photo.' });
      }
      const used = [depth && 'depth map', mask && 'roof mask', photos.length && `${photos.length} product photos`, swatch && 'texture sample'];
      console.log(`[generate] ${cfg.label} "${product.name}" (${used.filter(Boolean).join(', ') || 'photo only'}) -> ${results.length} images in ${Date.now() - started}ms`);
      res.json({ images: results, provider: cfg.type });
    } catch (err: any) {
      console.error('[generate] failed:', err);
      // Customers get a plain message; the full error stays in the server log.
      const message = String(err?.message ?? '');
      const code = err?.code === 'unavailable' || /API key|UNAUTHENTICATED|PERMISSION_DENIED|ACCOUNT_STATE_INVALID|\b401\b|\b403\b/.test(message)
        ? 'unavailable'
        : /RESOURCE_EXHAUSTED|\b429\b|quota/i.test(message)
          ? 'busy'
          : 'error';
      res.status(code === 'error' ? 500 : 503).json({ code, error: message });
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
    console.log(`Roof Visualizer running on http://localhost:${PORT} (image model: ${activeConfig().label})`);
  });
}

startServer();
