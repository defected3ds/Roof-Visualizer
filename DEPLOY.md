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
- **Updates:** every new push to this branch redeploys automatically.
- **Change the key or access code:** service → **Environment** → edit → **Save changes**. Render restarts the app.
- **Limit per visitor:** 20 generations per hour by default. Change it with an environment variable
  `RATE_LIMIT_PER_HOUR`.
- **Something wrong?** Service → **Logs** shows errors, and which AI model was used
  (`[gemini] using model gemini-nano-banana-2.1`).
- **Remove the access code** (fully public app): delete `APP_PASSWORD` in Environment. Only do this with the
  rate limit in place and a spending cap on your Gemini billing account.

## Manage your products (/admin)

The app has a back office at **`/admin`** (e.g. `https://roof-visualizer.onrender.com/admin`, or the small
"Manage products" link on the start screen). There you add, edit and delete roof products: photos, name, brand,
category and a description the AI uses.

It needs two more environment variables in Render (service → **Environment** → **Edit** → **+ Add**):

| Key | Value |
|---|---|
| `ADMIN_PASSWORD` | a password for the admin, different from `APP_PASSWORD` |
| `GITHUB_TOKEN` | a GitHub token, see below |

**Why GitHub?** Render's free plan wipes uploaded files every time the app restarts. With `GITHUB_TOKEN` set, every
product you save is also stored in this GitHub repo (`data/products.json` and `data/product-images/`), and Render
redeploys with it a few minutes later. You also get a full history of every change. Without the token, products
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
- After saving, the product is available immediately; Render then redeploys (about 3 minutes) to make it permanent.
