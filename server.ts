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
  getUsageSettings,
  IMAGE_URL_PREFIX,
  imageDir,
  listCategories,
  listProducts,
  referenceImages,
  saveAiSettings,
  saveUsageSettings,
  saveCategories,
  saveProduct,
  saveTexts,
  siteDir,
  SITE_URL_PREFIX,
  syncFromGitHub,
} from './server/store';
import { createProvider, estimateDepth, hasDepthKey, hasKey, hasMeasurementKey, hasSegmentationKey, imageLimit, PROVIDER_TYPES, segmentRoof, type Provider } from './server/providers';
import { buildModelPrompt, type ImageRoles } from './src/lib/prompt';
import { requestContext } from './server/visitor';
import { measureRoof, measurementText, recallMeasurement, rememberMeasurement } from './server/measure';
import { activePriceIds, attachPreviews, depthCost, measureCost, imageCost, listUsage, purgeUsage, recordUsage, roofMaskCost, usageLastError, usageStorage } from './server/usage';
import type { AiSettings, Category, GenerateBody, Product, ProductInput, ProviderConfig, Texts } from './src/types';
// Generations allowed per visitor IP per hour (each generation is several paid model calls).
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_HOUR) || 20;
const hits = new Map<string, number[]>();

// Roof masks per visitor IP per hour (one per photo, so more than generations).
const MASK_LIMIT = RATE_LIMIT * 3;

function rateLimited(ip: string, limit = RATE_LIMIT): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= limit) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

/** Ids made by the browser: short letters, digits and dashes only. */
function cleanId(value: unknown): string | null {
  const id = String(value ?? '');
  return /^[A-Za-z0-9-]{6,64}$/.test(id) ? id : null;
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
  // The admin's "Test this model" makes a depth map and roof mask like a real generation, with the admin password.
  const hasAccessOrAdmin = (req: express.Request) =>
    hasAccess(req) || (Boolean(adminPassword) && sameSecret(req.get('x-admin-password'), adminPassword));

  app.set('trust proxy', 1);
  app.use((req, _res, next) => requestContext.run(req, next));
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
    res.set('Cache-Control', 'no-store'); // settings can change in the admin at any time
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
      // Roof mask tool: SAM 3 on the server (needs its fal.ai key), else CLIPSeg in the browser.
      maskTool: ai.segmentation.tool === 'sam3' && hasSegmentationKey(ai.segmentation) ? 'sam3' : 'clipseg',
      // Depth map tool: Marigold on the server (needs its fal.ai key), else Depth Anything in the browser.
      depthTool: ai.depthEstimation.tool !== 'browser' && hasDepthKey(ai.depthEstimation) ? ai.depthEstimation.tool : 'browser',
      // Roof measurements (Depth Pro + SAM 3): on only when both tokens are set.
      measureShow: ai.measurement.show,
      measureTool: ai.measurement.tool === 'depthpro' && hasMeasurementKey(ai.measurement) && hasSegmentationKey(ai.segmentation) && usesImages ? 'depthpro' : 'off',
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
  // "Test Marigold" in AI settings: one depth map with the settings being edited.
  admin.post('/test-depth', async (req, res) => {
    const { image, depthEstimation } = (req.body ?? {}) as { image?: string; depthEstimation?: Partial<AiSettings['depthEstimation']> };
    if (!image?.startsWith('data:image/')) return res.status(400).json({ error: 'Expected { image: dataURL }' });
    const d = { ...getAiSettings().depthEstimation, ...depthEstimation };
    if (d.tool === 'browser') return res.status(400).json({ error: 'Choose Marigold or MiDaS to test it.' });
    if (!hasDepthKey(d)) return res.status(400).json({ error: `The key ${d.keyEnv} is not set on the server (Render → Environment).` });
    const started = Date.now();
    try {
      const depthImage = await estimateDepth(d, image);
      const ms = Date.now() - started;
      void recordUsage({ kind: 'test-depth', provider: d.tool === 'midas' ? 'MiDaS (fal.ai)' : 'Marigold (fal.ai)', model: d.tool, ms, cost: depthCost(getUsageSettings().prices, d.tool, ms) });
      res.json({ image: depthImage, ms });
    } catch (err: any) {
      res.status(502).json({ error: String(err?.message ?? err).slice(0, 400) });
    }
  });
  // "Test SAM 3" in AI settings: runs the roof mask on a photo with the settings being edited.
  admin.post('/test-roof-mask', async (req, res) => {
    const { image, segmentation } = (req.body ?? {}) as { image?: string; segmentation?: Partial<AiSettings['segmentation']> };
    if (!image?.startsWith('data:image/')) return res.status(400).json({ error: 'Expected { image: dataURL }' });
    const seg = { ...getAiSettings().segmentation, ...segmentation, tool: 'sam3' as const };
    if (!hasSegmentationKey(seg)) return res.status(400).json({ error: `The key ${seg.keyEnv} is not set on the server (Render → Environment).` });
    const started = Date.now();
    try {
      const masks = await segmentRoof(seg, image);
      const ms = Date.now() - started;
      void recordUsage({ kind: 'test-roof-mask', provider: 'SAM 3 (fal.ai)', model: 'sam3', ms, cost: roofMaskCost(getUsageSettings().prices) });
      res.json({ masks, ms });
    } catch (err: any) {
      res.status(502).json({ error: String(err?.message ?? err).slice(0, 400) });
    }
  });
  // "Test measurements" in AI settings: the full numbers for one photo.
  admin.post('/test-measure', async (req, res) => {
    const { image, measurement } = (req.body ?? {}) as { image?: string; measurement?: Partial<AiSettings['measurement']> };
    if (!image?.startsWith('data:image/')) return res.status(400).json({ error: 'Expected { image: dataURL }' });
    const ai = getAiSettings();
    const settings = { ...ai.measurement, ...measurement, tool: 'depthpro' as const };
    try {
      const m = await measureRoof(settings, { ...ai.segmentation, tool: 'sam3' }, image);
      void recordUsage({
        kind: 'test-measure',
        provider: 'Depth Pro (Replicate) + SAM 3',
        model: 'depth-pro',
        ms: m.ms,
        cost: measureCost(getUsageSettings().prices),
        detail: { confidence: m.confidence, planes: m.planes.length, up: m.up },
      });
      res.json({ measurement: m, text: measurementText(m) });
    } catch (err: any) {
      console.error('[test-measure] failed:', err);
      res.status(502).json({ error: String(err?.message ?? err).slice(0, 500) });
    }
  });
  // Cost history for Admin > Costs.
  admin.get('/usage', async (req, res) => {
    const days = Number(req.query.days);
    res.json({
      storage: usageStorage(),
      lastError: usageLastError() || undefined,
      events: await listUsage(Number.isFinite(days) && days > 0 ? days : null),
      settings: getUsageSettings(),
      activePrices: activePriceIds(getAiSettings()),
    });
  });
  admin.put('/usage-settings', async (req, res) => {
    try {
      const result = await saveUsageSettings(req.body);
      void purgeUsage(result.settings.retentionDays);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  admin.get('/ai', (_req, res) => {
    const settings = getAiSettings();
    res.json({
      settings,
      keyStatus: Object.fromEntries(settings.providers.map((p) => [p.id, hasKey(p)])),
      segmentationKey: hasSegmentationKey(settings.segmentation),
      measurementKey: hasMeasurementKey(settings.measurement),
      depthKey: hasDepthKey(settings.depthEstimation),
      types: PROVIDER_TYPES,
    });
  });
  admin.put('/ai', async (req, res) => {
    try {
      const result = await saveAiSettings(req.body as Partial<AiSettings>);
      res.json({
        ...result,
        keyStatus: Object.fromEntries(result.settings.providers.map((p) => [p.id, hasKey(p)])),
        segmentationKey: hasSegmentationKey(result.settings.segmentation),
        measurementKey: hasMeasurementKey(result.settings.measurement),
        depthKey: hasDepthKey(result.settings.depthEstimation),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });
  app.use('/api/admin', admin);

  // Small previews of a generation for the cost history (made in the visitor's browser).
  app.post('/api/usage/previews', async (req, res) => {
    if (!hasAccess(req)) return res.status(401).json({ error: 'Wrong or missing access code.', locked: true });
    if (rateLimited(`prev:${req.ip ?? 'unknown'}`, RATE_LIMIT * 4)) return res.status(429).end();
    const { generationId, house, results } = (req.body ?? {}) as { generationId?: string; house?: string; results?: string[] };
    const id = cleanId(generationId);
    const ok = (v: unknown): v is string => typeof v === 'string' && v.startsWith('data:image/jpeg;base64,') && v.length < 150_000;
    if (!id) return res.status(400).json({ error: 'Expected { generationId }' });
    await attachPreviews(id, { ...(ok(house) ? { house } : {}), results: (Array.isArray(results) ? results : []).filter(ok).slice(0, 4) });
    res.status(204).end();
  });

  // Failures in the visitor's browser (depth map, roof mask), so they show up in the server log.
  app.post('/api/client-log', (req, res) => {
    if (rateLimited(`log:${req.ip ?? 'unknown'}`, 30)) return res.status(429).end();
    const { kind, message, agent } = (req.body ?? {}) as Record<string, unknown>;
    const clean = (v: unknown, n: number) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
    console.warn(`[client] ${clean(kind, 40)} failed: ${clean(message, 300)} | ${clean(agent, 200)}`);
    res.status(204).end();
  });

  // Depth map with Marigold (fal.ai). The browser falls back to its own model when this fails.
  app.post('/api/depth-map', async (req, res) => {
    if (!hasAccessOrAdmin(req)) {
      return res.status(401).json({ error: 'Wrong or missing access code.', locked: true });
    }
    if (rateLimited(`depth:${req.ip ?? 'unknown'}`, MASK_LIMIT)) {
      return res.status(429).json({ code: 'limit', error: 'Too many depth maps. Try again later.' });
    }
    const { image, photoId } = req.body as { image?: string; photoId?: string };
    if (!image?.startsWith('data:image/')) return res.status(400).json({ error: 'Expected { image: dataURL }' });
    const d = getAiSettings().depthEstimation;
    if (d.tool === 'browser' || !hasDepthKey(d)) return res.status(503).json({ code: 'unavailable', error: 'The server depth map is off' });
    try {
      const started = Date.now();
      const depth = await estimateDepth(d, image);
      const ms = Date.now() - started;
      console.log(`[depth-map] ${d.tool === 'midas' ? 'MiDaS' : `Marigold ${d.quality}`} in ${ms} ms`);
      void recordUsage({
        kind: 'depth',
        photo_id: cleanId(photoId),
        provider: d.tool === 'midas' ? 'MiDaS (fal.ai)' : 'Marigold (fal.ai)',
        model: d.tool,
        ms,
        cost: depthCost(getUsageSettings().prices, d.tool, ms),
        detail: d.tool === 'marigold' ? { quality: d.quality } : null,
      });
      res.json({ image: depth });
    } catch (err) {
      console.error('[depth-map] failed:', err);
      res.status(502).json({ code: 'unavailable', error: 'Depth map failed' });
    }
  });

  // Roof measurements: SAM 3 (roof, wall) + Depth Pro + plane fitting. The result is kept for the photo and goes into the prompt at Generate.
  app.post('/api/measure', async (req, res) => {
    if (!hasAccessOrAdmin(req)) {
      return res.status(401).json({ error: 'Wrong or missing access code.', locked: true });
    }
    if (rateLimited(`measure:${req.ip ?? 'unknown'}`, MASK_LIMIT)) {
      return res.status(429).json({ code: 'limit', error: 'Too many measurements. Try again later.' });
    }
    const { image, photoId } = req.body as { image?: string; photoId?: string };
    if (!image?.startsWith('data:image/')) return res.status(400).json({ error: 'Expected { image: dataURL }' });
    const ai = getAiSettings();
    if (ai.measurement.tool !== 'depthpro' || !hasMeasurementKey(ai.measurement) || !hasSegmentationKey(ai.segmentation)) {
      return res.status(503).json({ code: 'unavailable', error: 'Measurement is off' });
    }
    try {
      const m = await measureRoof(ai.measurement, ai.segmentation, image);
      const id = cleanId(photoId);
      if (id) rememberMeasurement(id, m);
      console.log(`[measure] ${m.confidence} ${m.planes.map((p) => `${p.pitchDeg}°`).join(', ') || 'no plane'} in ${m.ms} ms`);
      const prices = getUsageSettings().prices;
      void recordUsage({
        kind: 'measure',
        photo_id: id,
        provider: 'Depth Pro (Replicate) + SAM 3',
        model: 'depth-pro',
        ms: m.ms,
        cost: measureCost(prices),
        detail: { confidence: m.confidence, planes: m.planes.length, up: m.up },
      });
      // Rounded, and only for a reliable result: this is what visitors may see.
      const main = [...m.planes].sort((a, b) => b.share - a.share)[0];
      const round = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);
      res.json({
        ok: true,
        confidence: m.confidence,
        depthColor: ai.measurement.show && m.confidence === 'ok' ? m.colorMap : undefined,
        summary: ai.measurement.show && m.confidence === 'ok' && main ? { pitchDeg: round(main.pitchDeg, 5), areaM2: round(m.roofAreaM2, m.roofAreaM2 >= 20 ? 5 : 1) } : undefined,
      });
    } catch (err) {
      console.error('[measure] failed:', err);
      res.status(502).json({ code: 'unavailable', error: 'Measurement failed' });
    }
  });

  // Roof mask with SAM 3 (fal.ai). The browser falls back to CLIPSeg when this fails.
  app.post('/api/roof-mask', async (req, res) => {
    if (!hasAccessOrAdmin(req)) {
      return res.status(401).json({ error: 'Wrong or missing access code.', locked: true });
    }
    if (rateLimited(`mask:${req.ip ?? 'unknown'}`, MASK_LIMIT)) {
      return res.status(429).json({ code: 'limit', error: 'Too many roof masks. Try again later.' });
    }
    const { image, photoId, target } = req.body as { image?: string; photoId?: string; target?: string };
    if (!image?.startsWith('data:image/')) return res.status(400).json({ error: 'Expected { image: dataURL }' });
    const ai = getAiSettings();
    // target "wall": the wall found for the roof measurement (shown on the loading screen).
    const wall = target === 'wall';
    const seg = wall ? { ...ai.segmentation, prompt: ai.measurement.wallPrompt || 'wall' } : ai.segmentation;
    if (seg.tool !== 'sam3' || !hasSegmentationKey(seg)) return res.status(503).json({ code: 'unavailable', error: 'SAM 3 is off' });
    if (wall && ai.measurement.tool !== 'depthpro') return res.status(503).json({ code: 'unavailable', error: 'Measurement is off' });
    try {
      const started = Date.now();
      const masks = await segmentRoof(seg, image);
      const ms = Date.now() - started;
      console.log(`[roof-mask] SAM 3 "${seg.prompt}" -> ${masks.length} mask(s) in ${ms} ms`);
      void recordUsage({
        kind: 'roof-mask',
        photo_id: cleanId(photoId),
        provider: 'SAM 3 (fal.ai)',
        model: 'sam3',
        ms,
        cost: roofMaskCost(getUsageSettings().prices),
        detail: { masks: masks.length, ...(wall ? { target: 'wall' } : {}) },
      });
      res.json({ masks });
    } catch (err) {
      console.error('[roof-mask] failed:', err);
      res.status(502).json({ code: 'unavailable', error: 'Roof segmentation failed' });
    }
  });

  /** Images in priority order (house photo, depth map, roof mask, product photos), up to what the model accepts, and the prompts. */
  async function buildRequest(ai: AiSettings, cfg: ProviderConfig, body: GenerateBody, product: Product, variants: number) {
    const dataUrl = (v?: string) => (v?.startsWith('data:image/') ? v : undefined);
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
    const measured = ai.measurement.tool === 'depthpro' ? measurementText(recallMeasurement(cleanId(body.photoId) ?? undefined), product) : '';
    const prompts = Array.from({ length: variants }, (_, v) => buildModelPrompt(ai, cfg, product, category, roles, v, measured).prompt);
    return { images, prompts, depth, mask, photos, swatch, measured: Boolean(measured) };
  }

  // "Test this model" in AI settings: one real generation with a model card as it is being edited.
  admin.post('/test-model', async (req, res) => {
    const { provider, image, productId, depth, mask } = (req.body ?? {}) as {
      provider?: ProviderConfig;
      image?: string;
      productId?: string;
      depth?: string;
      mask?: string;
    };
    const product = productId ? getProduct(productId) : undefined;
    if (!provider || !image?.startsWith('data:image/') || !product) {
      return res.status(400).json({ error: 'Expected { provider, image: dataURL, productId }' });
    }
    const started = Date.now();
    try {
      const cfg = { ...provider, keyEnv: String(provider.keyEnv ?? '').trim().toUpperCase() };
      const built = await buildRequest(getAiSettings(), cfg, { image, productId: product.id, depth, mask, count: 1 }, product, 1);
      const { images, prompts } = built;
      const sent = ['house photo', built.depth && 'depth map', built.mask && 'roof mask', built.photos.length && `${built.photos.length} product photo${built.photos.length > 1 ? 's' : ''}`, built.swatch && 'texture sample'].filter(Boolean);
      const results = await createProvider(cfg).generate({ images, prompts });
      if (!results.length) return res.status(502).json({ error: 'The model returned no image.' });
      console.log(`[test-model] ${cfg.label} (${cfg.model}) "${product.name}" ok in ${Date.now() - started}ms`);
      const priced = imageCost(getUsageSettings().prices, cfg, images, results.length);
      void recordUsage({
        kind: 'test-image',
        product: [product.brand, product.name].filter(Boolean).join(' '),
        provider: cfg.label,
        model: cfg.model || cfg.type,
        results: results.length,
        ms: Date.now() - started,
        cost: priced.cost,
        detail: { sent, basis: priced.basis, imagesMP: priced.imagesMP },
      });
      res.json({ image: results[0], ms: Date.now() - started, imagesSent: images.length, sent });
    } catch (err: any) {
      console.error(`[test-model] ${provider.label} failed:`, err);
      res.status(502).json({ error: String(err?.message ?? err).slice(0, 500) });
    }
  });

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
    const { images, prompts, depth, mask, photos, swatch, measured } = await buildRequest(ai, cfg, body as GenerateBody, product, ai.variants);

    const started = Date.now();
    const usage = {
      photo_id: cleanId(body.photoId),
      generation_id: cleanId(body.generationId),
      product: [product.brand, product.name].filter(Boolean).join(' '),
      provider: cfg.label,
      model: cfg.model || cfg.type,
    };
    const sent = ['house photo', depth && 'depth map', mask && 'roof mask', photos.length && `${photos.length} product photo${photos.length > 1 ? 's' : ''}`, swatch && 'texture sample', measured && 'roof measurements'].filter(Boolean);
    try {
      const results = await providerFor(cfg).generate({ images, prompts });
      if (results.length === 0) {
        return res.status(502).json({ error: 'The model returned no images. Try again or pick another photo.' });
      }
      const used = [depth && 'depth map', mask && 'roof mask', photos.length && `${photos.length} product photos`, swatch && 'texture sample'];
      console.log(`[generate] ${cfg.label} "${product.name}" (${used.filter(Boolean).join(', ') || 'photo only'}) -> ${results.length} images in ${Date.now() - started}ms`);
      const priced = imageCost(getUsageSettings().prices, cfg, images, results.length);
      void recordUsage({ kind: 'image', ...usage, results: results.length, ms: Date.now() - started, cost: priced.cost, detail: { sent, basis: priced.basis, imagesMP: priced.imagesMP } });
      res.json({ images: results, provider: cfg.type });
    } catch (err: any) {
      console.error('[generate] failed:', err);
      void recordUsage({ kind: 'image', ...usage, results: 0, ms: Date.now() - started, cost: 0, detail: { sent, error: String(err?.message ?? err).slice(0, 300) } });
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

  // Previews of visitors' photos are removed after the retention period (costs stay).
  const purge = () => purgeUsage(getUsageSettings().retentionDays);
  void purge();
  setInterval(purge, 6 * 3600_000).unref();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Roof Visualizer running on http://localhost:${PORT} (image model: ${activeConfig().label})`);
  });
}

startServer();
