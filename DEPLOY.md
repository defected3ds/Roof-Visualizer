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
6. Open the link on your phone, upload a house photo, press **Generate**, and enter your access code once.
   The phone remembers it.

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
