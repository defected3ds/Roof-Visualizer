/**
 * Runs real photos through the configured AI provider without the UI.
 *
 *   npx tsx scripts/try.ts photo1.jpg photo2.jpg --material barrel-terracotta --count 2
 *
 * Results are written to test-output/<photo>-<material>-<n>.<ext>.
 * Swatches are browser-rendered, so this sends the text prompt only.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pickProvider } from '../server/providers';
import { MATERIALS } from '../src/materials';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const materialIds = (flag('material') ?? 'barrel-terracotta').split(',');
const count = Number(flag('count') ?? 1);
const photos = args;

if (photos.length === 0) {
  console.error('Usage: npx tsx scripts/try.ts <photo...> [--material id1,id2] [--count n]');
  console.error('Materials:', MATERIALS.map((m) => m.id).join(', '));
  process.exit(1);
}

const provider = pickProvider();
console.log(`Provider: ${provider.name}`);
const outDir = path.join(process.cwd(), 'test-output');
fs.mkdirSync(outDir, { recursive: true });

for (const photo of photos) {
  const ext = path.extname(photo).slice(1).toLowerCase().replace('jpg', 'jpeg');
  const image = `data:image/${ext};base64,${fs.readFileSync(photo).toString('base64')}`;
  for (const id of materialIds) {
    const material = MATERIALS.find((m) => m.id === id);
    if (!material) throw new Error(`Unknown material "${id}"`);
    const started = Date.now();
    try {
      const images = await provider.generate({ image, material, count });
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
