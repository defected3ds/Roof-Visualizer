# Roof Visualizer

Take a photo of a house, pick a roofing material (tile, shingles, slate, shake, metal), and AI re-roofs the
house while keeping everything else the same. Each generation returns 3 variants: swipe between them, compare
before/after, accept one, and keep iterating with undo/redo. Mobile-first web app.

## Run it

```bash
npm install
cp .env.example .env   # add GEMINI_API_KEY (or REPLICATE_API_TOKEN)
npm run dev            # http://localhost:3000
```

With no key the app runs in **demo mode**: the whole UI works but "results" are your original photo.

Production: `npm run build && npm start`.

**Put it online:** see [DEPLOY.md](DEPLOY.md) (one-click Render.com setup with an access code).

Optional env vars for a public deployment: `APP_PASSWORD` (access code needed to generate) and
`RATE_LIMIT_PER_HOUR` (per visitor IP, default 20).

## How it works

```
photo ─► browser: EXIF-rotate + resize to ≤1536px, render material swatch
      ─► POST /api/generate { image, swatch, material.prompt, count: 3 }
      ─► server: image-editing model, 3 parallel calls
           "replace ONLY the roof covering with <material>; keep walls, windows,
            sky, camera angle and roof geometry identical"  + swatch as texture reference
      ─► 3 images ─► swipe / compare / accept (accepted image becomes the new base)
```

**Depth:** as soon as a photo is picked, the browser estimates a depth map with Depth Anything V2 (small) via
transformers.js (`src/lib/depth.ts`; library and model load from public CDNs and are cached). The grey depth map is
sent to the model with the photo so it understands the roof planes and pitch; generation waits for it at most 12 s.

While waiting, the app shows the depth maps and line / edge / soft-edge maps of the photo (computed in the browser with
Sobel + non-max suppression). These are the same kinds of structure maps that ControlNet pipelines use, and
the same effect you see in other roof visualizer apps.

### AI backends (`server/providers.ts`)

| Provider | Env | Model | Notes |
|---|---|---|---|
| Gemini (default) | `GEMINI_API_KEY` | Nano Banana 2.1 (`gemini-nano-banana-2.1`), fallback `gemini-3.1-flash-image` / `gemini-2.5-flash-image` | Uses the swatch image as a texture reference |
| Replicate | `REPLICATE_API_TOKEN` | `black-forest-labs/flux-kontext-pro` | Instruction-based editing; text prompt only |
| Demo | none | none | Echoes the photo |

Set `AI_PROVIDER=gemini|replicate|demo` to force one when several keys are set.

## Products

Everything is managed in the app at **`/admin`** (protected by `ADMIN_PASSWORD`) and stored in `data/`:

| File | Content |
|---|---|
| `data/categories.json` | categories (name, AI note), in display order |
| `data/products.json` | products: name, brand, category, AI description, technical data, photos |
| `data/product-images/` | product photos |
| `data/texts.json` | app texts that differ from the defaults in `src/texts.ts` |

With every generation the model gets the product description, technical data, the category note and the first
3 product photos as references. Products without photos use a drawn texture (`src/lib/swatch.ts`).

On hosts with a throwaway disk (Render), set `GITHUB_TOKEN` so admin changes are committed back to the repo
(`server/github.ts`); see DEPLOY.md.

## Ideas for next steps

- Roof mask: segment the roof (e.g. SAM / Grounded-SAM "roof"), let users touch it up with a brush, and composite
  the result back onto the original so non-roof pixels are guaranteed untouched.
- A self-hosted ComfyUI pipeline (SDXL/Flux inpaint + ControlNet + IP-Adapter) with a LoRA per product line, for
  results that match the real products closely.
- Save projects (Firebase), quote request / lead form, native wrapper (Capacitor) for app stores.
