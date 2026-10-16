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

## How it works

```
photo ─► browser: EXIF-rotate + resize to ≤1536px, render material swatch
      ─► POST /api/generate { image, swatch, material.prompt, count: 3 }
      ─► server: image-editing model, 3 parallel calls
           "replace ONLY the roof covering with <material>; keep walls, windows,
            sky, camera angle and roof geometry identical"  + swatch as texture reference
      ─► 3 images ─► swipe / compare / accept (accepted image becomes the new base)
```

While waiting, the app shows line / edge / soft-edge maps of the photo (computed in the browser with
Sobel + non-max suppression). These are the same kinds of structure maps that ControlNet pipelines use, and
the same effect you see in other roof visualizer apps.

### AI backends (`server/providers.ts`)

| Provider | Env | Model | Notes |
|---|---|---|---|
| Gemini (default) | `GEMINI_API_KEY` | `gemini-3.1-flash-image`, fallback `gemini-2.5-flash-image` | Uses the swatch image as a texture reference |
| Replicate | `REPLICATE_API_TOKEN` | `black-forest-labs/flux-kontext-pro` | Instruction-based editing; text prompt only |
| Demo | none | none | Echoes the photo |

Set `AI_PROVIDER=gemini|replicate|demo` to force one when several keys are set.

## Customising materials

`src/materials.ts` lists the catalog. Each entry has a display name, category, the **prompt** sent to the model
(this matters most), and colours/pattern for the procedurally drawn swatch (`src/lib/swatch.ts`). To show
real products, put the manufacturer's colour names in and describe them precisely; you can also replace
`renderSwatch` with real product photos.

## Ideas for next steps

- Roof mask: segment the roof (e.g. SAM / Grounded-SAM "roof"), let users touch it up with a brush, and composite
  the result back onto the original so non-roof pixels are guaranteed untouched.
- A self-hosted ComfyUI pipeline (SDXL/Flux inpaint + ControlNet + IP-Adapter) with a LoRA per product line, for
  results that match the real products closely.
- Save projects (Firebase), quote request / lead form, native wrapper (Capacitor) for app stores.
