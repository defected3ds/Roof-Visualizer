import type { Product } from '../types';

const FALLBACK: NonNullable<Product['swatch']> = { pattern: 'flat-tile', colors: ['#8a8a8a', '#4a4a4a', '#b5b5b5'] };

const cache = new Map<string, string>();

function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function speckle(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, amount: number, alpha: number) {
  for (let i = 0; i < amount; i++) {
    const light = rnd() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha * rnd()})` : `rgba(0,0,0,${alpha * rnd()})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
}

/** Drawn texture for products without photos; also sent to the model as a texture sample. */
export function renderSwatch(product: Product, size = 320): string {
  const swatch = product.swatch ?? FALLBACK;
  const key = `${product.id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const [base, dark, light] = swatch.colors;
  const rnd = seededRandom(product.id);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, size, size);

  switch (swatch.pattern) {
    case 'barrel': {
      const rowH = size / 4;
      const colW = size / 5;
      for (let row = 3; row >= -1; row--) {
        const y = row * rowH * 0.92;
        for (let col = -1; col <= 5; col++) {
          const x = col * colW;
          const g = ctx.createLinearGradient(x, 0, x + colW, 0);
          g.addColorStop(0, dark);
          g.addColorStop(0.35, base);
          g.addColorStop(0.55, light);
          g.addColorStop(0.8, base);
          g.addColorStop(1, dark);
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.roundRect(x + 1, y, colW - 2, rowH * 1.05, [colW / 2, colW / 2, 4, 4]);
          ctx.fill();
          ctx.fillStyle = `rgba(0,0,0,${0.1 + rnd() * 0.25})`;
          ctx.fillRect(x + 1, y + rowH * 0.85, colW - 2, rowH * 0.2);
        }
      }
      speckle(ctx, size, rnd, 2500, 0.18);
      break;
    }
    case 'flat-tile':
    case 'slate': {
      const isSlate = swatch.pattern === 'slate';
      const rows = isSlate ? 7 : 6;
      const cols = isSlate ? 4 : 5;
      const rowH = size / rows;
      const colW = size / cols;
      for (let row = 0; row < rows; row++) {
        const offset = row % 2 ? colW / 2 : 0;
        for (let col = -1; col <= cols; col++) {
          const x = col * colW + offset;
          const y = row * rowH;
          const g = ctx.createLinearGradient(0, y, 0, y + rowH);
          const mix = rnd();
          g.addColorStop(0, mix > 0.7 ? light : base);
          g.addColorStop(1, mix < 0.3 ? dark : base);
          ctx.fillStyle = g;
          const jag = isSlate ? rnd() * 3 : 0;
          ctx.fillRect(x + 2, y + 2 + jag, colW - 4, rowH - 3 - jag);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(x + 2, y + rowH - 4, colW - 4, 3);
        }
      }
      speckle(ctx, size, rnd, isSlate ? 4000 : 1500, isSlate ? 0.25 : 0.15);
      break;
    }
    case 'shingle': {
      const rows = 6;
      const rowH = size / rows;
      for (let row = 0; row < rows; row++) {
        let x = -rnd() * 40;
        while (x < size) {
          const w = 30 + rnd() * 50;
          const shade = rnd();
          ctx.fillStyle = shade > 0.66 ? light : shade > 0.33 ? base : dark;
          ctx.fillRect(x + 1, row * rowH + 1, w - 2, rowH - 2);
          x += w;
        }
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(0, row * rowH + rowH - 3, size, 3);
      }
      speckle(ctx, size, rnd, 9000, 0.35);
      break;
    }
    case 'shake': {
      const rows = 4;
      const rowH = size / rows;
      for (let row = 0; row < rows; row++) {
        let x = -rnd() * 30;
        while (x < size) {
          const w = 16 + rnd() * 34;
          const y = row * rowH;
          const g = ctx.createLinearGradient(x, 0, x + w, 0);
          g.addColorStop(0, base);
          g.addColorStop(rnd(), rnd() > 0.5 ? light : base);
          g.addColorStop(1, dark);
          ctx.fillStyle = g;
          ctx.fillRect(x + 1, y, w - 2, rowH - 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.25)';
          for (let i = 0; i < 4; i++) {
            const gx = x + 3 + rnd() * (w - 6);
            ctx.beginPath();
            ctx.moveTo(gx, y);
            ctx.lineTo(gx + (rnd() - 0.5) * 4, y + rowH - 2);
            ctx.stroke();
          }
          x += w;
        }
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, row * rowH + rowH - 4, size, 4);
      }
      speckle(ctx, size, rnd, 1500, 0.2);
      break;
    }
    case 'seam': {
      const panelW = size / 5;
      for (let i = 0; i < 5; i++) {
        const x = i * panelW;
        const g = ctx.createLinearGradient(x, 0, x + panelW, 0);
        g.addColorStop(0, base);
        g.addColorStop(0.5, light);
        g.addColorStop(1, base);
        ctx.fillStyle = g;
        ctx.fillRect(x, 0, panelW, size);
        ctx.fillStyle = light;
        ctx.fillRect(x + panelW - 5, 0, 3, size);
        ctx.fillStyle = dark;
        ctx.fillRect(x + panelW - 2, 0, 3, size);
      }
      const sheen = ctx.createLinearGradient(0, 0, size, size);
      sheen.addColorStop(0, 'rgba(255,255,255,0.12)');
      sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
      sheen.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = sheen;
      ctx.fillRect(0, 0, size, size);
      break;
    }
  }

  const url = canvas.toDataURL('image/jpeg', 0.88);
  cache.set(key, url);
  return url;
}

/** Thumbnail for a product: its first photo, or the drawn texture. */
export function productThumb(product: Product, size = 320): string {
  return product.images[0] ?? renderSwatch(product, size);
}
