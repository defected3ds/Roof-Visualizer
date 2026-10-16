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

**Depth and roof mask:** as soon as a photo is picked, the browser estimates a depth map (Depth Anything V2 small)
and a roof mask (CLIPSeg) via transformers.js (`src/lib/depth.ts`, `src/lib/roofmask.ts`; library and models load
from public CDNs and are cached). Both are sent to the model with the photo; generation waits for them at most 20 s.

While waiting, the app shows the depth maps and line / edge / soft-edge maps of the photo (computed in the browser with
Sobel + non-max suppression). These are the same kinds of structure maps that ControlNet pipelines use, and
the same effect you see in other roof visualizer apps.

### AI settings (`/admin` > AI settings, saved in `data/ai.json`)

- **System prompt:** the general instructions. `{{product}}` and `{{images}}` mark where the selected product's
  data and the guide to the attached images go (`src/lib/prompt.ts` builds the final prompt; the admin shows a
  live preview of it for any product).
- **What the AI receives:** switches for product description, technical data, product photos (1–3), depth map and
  roof mask, and the number of results per generation.
- **While generating:** switch the line / edge maps on the loading screen on or off (display only, never sent to
  the AI).
- **Image models:** any number of entries of these API types, one of them active:

| API type | Key variable | Model example | Images accepted |
|---|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | `gemini-nano-banana-2.1` | 8 |
| OpenAI Images | `OPENAI_API_KEY` | `gpt-image-2.5-flare`, `gpt-image-2.5-sunburst`, `gpt-image-1` | 8 |
| Black Forest Labs (bfl.ai) | `BFL_API_KEY` | `flux-2-pro`, `flux-2-max` (8) or `flux-kontext-pro` (1) | 8 / 1 |
| fal.ai | `FAL_KEY` (or `FAL_API_KEY`) | `krea/v3/edit`, `fal-ai/nano-banana-pro/edit` (8) or `fal-ai/flux-pro/kontext` (1) | 8 / 1 |
| kie.ai | `KIE_API_KEY` | `google/nano-banana-edit` | 10 |
| Replicate | `REPLICATE_API_TOKEN` | `black-forest-labs/flux-kontext-pro` | 1 |
| Demo | none | none | runs the whole pipeline, returns the photo |

Each model card can have its **own system prompt** (used instead of the general one). Models with a prompt limit
(Krea 3 on fal.ai: 5,000 characters, `promptLimit` in `src/lib/models.ts`) get the system prompt shortened at a
paragraph when needed; product data and the image guide are always sent whole.

Each model card has **Test this model**: one real generation on the start photo with a chosen product, showing the
result or the provider's error message.

Images are sent in priority order (house photo, depth map, roof mask, product photos) up to the model's limit
(`src/lib/models.ts`), and the prompt only describes the images actually sent. `BFL_API_URL` (e.g. the EU endpoint
`https://api.eu.bfl.ai`), `FAL_QUEUE_URL` and `KIE_API_URL` override the API addresses.

API keys are never stored in the settings (they are committed to GitHub); each model names the environment variable
that holds its key (see the table). Before the first save the
active model is chosen as before (`AI_PROVIDER`, else the first model with a key).

**Roof mask** (Admin > AI settings > Roof mask tool):
- **Meta SAM 3 on fal.ai** (default when `FAL_API_KEY` or `FAL_KEY` is set): the server sends the photo to
  `fal-ai/sam-3/image` with the text "roof" (`POST /api/roof-mask`, about $0.005 per photo) and the browser merges
  the returned masks. Sharp, accurate outlines. `FAL_RUN_URL` overrides the API address.
- **CLIPSeg** (`Xenova/clipseg-rd64-refined`, prompts "roof" / "roof tiles"), free in the browser next to the depth
  map, rough edges. Also used automatically when SAM 3 fails.

Both live in `src/lib/roofmask.ts`.

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
