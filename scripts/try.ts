/**
 * Runs real photos through the configured AI provider without the UI.
 *
 *   npx tsx scripts/try.ts photo1.jpg photo2.jpg --product barrel-terracotta --count 2
 *
 * Results are written to test-output/<photo>-<material>-<n>.<ext>.
 * Uses the active image model and system prompt from data/ai.json. Product photos are sent as references;
 * depth maps and roof masks are browser-only, so they are not used here.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { createProvider } from '../server/providers';
import { buildFinalPrompt } from '../src/lib/prompt';
import { getAiSettings, getCategory, getProduct, listProducts, referenceImages } from '../server/store';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const materialIds = (flag('product') ?? flag('material') ?? 'barrel-terracotta').split(',');
const count = Number(flag('count') ?? 1);
const photos = args;

if (photos.length === 0) {
  console.error('Usage: npx tsx scripts/try.ts <photo...> [--product id1,id2] [--count n]');
  console.error('Products:', listProducts().map((p) => p.id).join(', '));
  process.exit(1);
}

const ai = getAiSettings();
const provider = createProvider(ai.providers.find((p) => p.id === ai.activeProvider) ?? ai.providers[0]);
console.log(`Image model: ${provider.name}`);
const outDir = path.join(process.cwd(), 'test-output');
fs.mkdirSync(outDir, { recursive: true });

for (const photo of photos) {
  const ext = path.extname(photo).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const image = `data:image/${ext};base64,${fs.readFileSync(photo).toString('base64')}`;
  for (const id of materialIds) {
    const product = getProduct(id);
    if (!product) throw new Error(`Unknown product "${id}"`);
    const references = await referenceImages(product);
    const started = Date.now();
    try {
      const roles = { depth: false, mask: false, productPhotos: references.length, swatch: false };
      const prompts = Array.from({ length: count }, (_, v) => buildFinalPrompt(ai, product, getCategory(product.category), roles, v));
      const images = await provider.generate({ images: [image, ...references], prompts });
      images.forEach((dataUrl, n) => {
        const [, mime, b64] = /^data:image\/([^;]+);base64,(.*)$/s.exec(dataUrl)!;
        const file = path.join(outDir, `${path.parse(photo).name}-${id}-${n + 1}.${mime === 'jpeg' ? 'jpg' : mime}`);
        fs.writeFileSync(file, Buffer.from(b64, 'base64'));
        console.log(`  saved ${path.relative(process.cwd(), file)}`);
      });
      console.log(`${path.basename(photo)} × ${id}: ${images.length} image(s) in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err: any) {
      console.error(`${path.basename(photo)} × ${id}: FAILED — ${err.message}`);
    }
  }
}
