import 'dotenv/config';
import express from 'express';
import path from 'path';
import { pickProvider } from './server/providers';
import type { GenerateRequest } from './src/types';

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

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const provider = pickProvider();

  const accessCode = process.env.APP_PASSWORD || '';

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '30mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: provider.name, locked: Boolean(accessCode) });
  });

  app.post('/api/generate', async (req, res) => {
    if (accessCode && req.get('x-access-code') !== accessCode) {
      return res.status(401).json({ error: 'Wrong or missing access code.', locked: true });
    }
    if (rateLimited(req.ip ?? 'unknown')) {
      return res.status(429).json({ error: `Limit reached (${RATE_LIMIT} generations per hour). Try again later.` });
    }
    const body = req.body as Partial<GenerateRequest>;
    if (!body.image?.startsWith('data:image/') || !body.material?.prompt) {
      return res.status(400).json({ error: 'Expected { image: dataURL, material: { prompt } }' });
    }
    const count = Math.min(Math.max(Number(body.count) || 3, 1), MAX_VARIANTS);
    const started = Date.now();
    try {
      const images = await provider.generate({
        image: body.image,
        swatch: body.swatch,
        material: body.material,
        count,
      });
      if (images.length === 0) {
        return res.status(502).json({ error: 'The model returned no images. Try again or pick another photo.' });
      }
      console.log(`[generate] ${provider.name} "${body.material.name}" -> ${images.length} images in ${Date.now() - started}ms`);
      res.json({ images, provider: provider.name });
    } catch (err: any) {
      console.error('[generate] failed:', err);
      res.status(500).json({ error: err?.message || 'Generation failed' });
    }
  });

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
