# Put Roof Visualizer online (Render.com)

You get a public link like `https://roof-visualizer.onrender.com`. No coding needed. About 10 minutes.

## What you need

- Your GitHub account (the one that owns this repo).
- Your Gemini API key (from https://aistudio.google.com/apikey).
- An **access code** you make up, for example `roof2026`. Only people who know it can generate roofs, so
  strangers can't spend your Gemini credits.

## Steps

1. Click this button:

   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/defected3ds/roof-visualizer)

2. Choose **Sign in with GitHub** and allow Render to see the `roof-visualizer` repository
   (pick "Only select repositories" → `roof-visualizer` if it asks).
3. Render shows a setup page called **Blueprint** with one service, `roof-visualizer`. Give the blueprint any name.
   It asks for two values:
   - `GEMINI_API_KEY` → paste your Gemini key
   - `APP_PASSWORD` → type the access code you made up
4. Click **Deploy Blueprint** / **Apply**. The first build takes 3–5 minutes.
5. Open the **roof-visualizer** service. Your link is at the top of the page (`https://….onrender.com`).
6. Open the link on your phone. The app opens on a **Sign in** screen: enter your access code once and the
   phone remembers it. Share the link and the code only with people who should use the app.

## Good to know

- **Free plan:** the app goes to sleep after 15 minutes without visitors. The next visit takes about a minute to
  wake it up, then it is fast again. To avoid that, upgrade the service to the *Starter* plan in Render (about $7/month).
- **Updates:** Render deploys new code only if **Auto-Deploy** is on (service → **Settings** → **Build & Deploy** →
  **Auto-Deploy: On Commit**). Otherwise use **Manual Deploy → Deploy latest commit** after each update.
- **Products, categories and texts** are loaded from GitHub every time the app starts (with `GITHUB_TOKEN`), so admin
  changes never depend on a redeploy.
- **Change the key or access code:** service → **Environment** → edit → **Save changes**. Render restarts the app.
- **Limit per visitor:** 20 generations per hour by default. Change it with an environment variable
  `RATE_LIMIT_PER_HOUR`.
- **Something wrong?** Service → **Logs** shows errors, and which AI model was used
  (`[gemini] using model gemini-nano-banana-2.1`).
- **Remove the access code** (fully public app): delete `APP_PASSWORD` in Environment. Only do this with the
  rate limit in place and a spending cap on your Gemini billing account.

## Manage your products (/admin)

The app has a back office at **`/admin`** (e.g. `https://roof-visualizer.onrender.com/admin`, or the small
"Manage products" link on the start screen). It has three tabs:

- **Products:** add, edit and delete products: photos, name, brand, category, a description for the AI and a
  **technical data** table (paste it straight from a product page, PDF or spreadsheet with "Paste a table").
  Customers see the technical data when they tap the product name in the app.
- **Categories:** rename, reorder, add and delete the categories customers filter by, each with a short note for
  the AI. A category can only be deleted once it has no products.
- **App texts:** every text customers see, with ready-made defaults. Change any of them; "Default" restores one.
- **AI settings:** the system prompt (with a live preview of the final prompt for any product), what the AI receives
  (product data, technical data, product photos, depth map, roof mask) and which image model is active. To use
  another model, add its API key in Render → Environment under the variable name shown there (for example
  `OPENAI_API_KEY`), then make it active. Keys are never typed into the admin.

It needs two more environment variables in Render (service → **Environment** → **Edit** → **+ Add**):

| Key | Value |
|---|---|
| `ADMIN_PASSWORD` | a password for the admin, different from `APP_PASSWORD` |
| `GITHUB_TOKEN` | a GitHub token, see below |

**Why GitHub?** Render's free plan wipes uploaded files every time the app restarts. With `GITHUB_TOKEN` set, every
product you save is also stored in this GitHub repo (`data/`), and the app reloads it from there whenever it starts. You also get a full history of every change. Without the token, products
you add disappear at the next restart (the admin page warns you).

**Create the GitHub token (once):**

1. Open https://github.com/settings/personal-access-tokens/new (GitHub → your photo → Settings →
   Developer settings → Personal access tokens → **Fine-grained tokens** → **Generate new token**).
2. Name: `roof-visualizer admin`. Expiration: choose a date (you will need a new token after it).
3. **Repository access** → **Only select repositories** → `roof-visualizer`.
4. **Permissions** → **Repository permissions** → **Contents** → **Read and write**.
5. **Generate token**, copy it (starts with `github_pat_`) and paste it as `GITHUB_TOKEN` in Render.

**Tips for good results**

- Photos matter most. Upload a straight-on close-up of the tiles laid on a roof, a photo of a finished roof
  with the product, and a single tile. The first 3 photos are sent to the AI with every generation.
- Describe the product the way a roofer would: shape/profile, exact colour and colour variation, surface
  (matte, engobed, glazed), size or tiles per m², laying pattern, ridge tiles. Skip marketing words.
- After saving, the product is available immediately and stored in GitHub, so it survives restarts.


## Cost history (Admin > Costs)

The **Costs** tab lists every API call the app makes (image generations, depth maps, roof masks, and your admin tests) with an
estimated cost, plus small previews of the house photo and the results. Costs are estimates: units used × the price table in the
tab (US dollars), which you can edit. Previews are deleted after 30 days (changeable); the costs stay.

Without a database the history is kept in memory only and disappears when Render restarts the app. To keep it for good, use a free
Supabase database (about 5 minutes, once):

1. Go to https://supabase.com, sign in (GitHub login works) and click **New project**. Pick a name, a database password (you won't
   need it again) and the region closest to you (for example Frankfurt).
2. When the project is ready open **SQL Editor** > **New query**, paste the contents of `docs/supabase.sql` from this repository and
   click **Run**. It creates one table, `usage_events`, that nobody but the server can read.
3. Open **Project Settings** > **API**. Copy two things:
   - **Project URL** (like `https://abcdefgh.supabase.co`)
   - the **service_role** key (the secret one, not the anon key; click Reveal)
4. In Render: your service > **Environment** > add `SUPABASE_URL` (the Project URL) and `SUPABASE_SERVICE_KEY` (the service_role
   key) > **Save changes**. Never paste the key in chat, in GitHub or in the admin.
5. Open **Admin > Costs**. It now says nothing about "temporary history", and new generations appear there.

**Privacy:** the start screen has a note (editable under App texts, "Privacy note under the buttons") that previews are kept for up
to 30 days. Change the number of days in Admin > Costs > Price table, and keep the note in step with it.

## Roof measurements (optional)

Admin → AI settings → **Roof measurements**. Off by default (the old setup). When switched to *Depth Pro on Replicate + SAM 3*, the server
measures each photo (pitch, eave and slope length, area) and adds a short block to the prompt that helps the model judge the tile size.

1. Create a token at replicate.com (Account → API tokens) and add it in Render → Environment as `REPLICATE_API_TOKEN`.
2. The SAM 3 roof mask tool must be on (it needs `FAL_API_KEY`); the measurement uses SAM 3 to find the roof and a wall.
3. In AI settings choose the measurement tool, save, then press **Measure the start photo** or **Measure my own photo…** to see the numbers.
   Check them against a house whose real size you know before leaving it on.

It costs one Depth Pro call and two SAM 3 calls per photo (the Costs tab shows it as "Roof measurement"; the Depth Pro price in the price table is a
guess until you have seen the first Replicate bill). If a photo can't be measured reliably, no numbers are sent. `DEPTH_PRO_VERSION` (optional)
overrides the Replicate model version. Check the Depth Pro licence for commercial use before going live.
