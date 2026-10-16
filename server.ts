import 'dotenv/config';
import express from 'express';
import path from 'path';
import { pickProvider } from './server/providers';
import type { GenerateRequest } from './src/types';

const MAX_VARIANTS = 4;

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const provider = pickProvider();

  app.use(express.json({ limit: '30mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, provider: provider.name });
  });

  app.post('/api/generate', async (req, res) => {
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
