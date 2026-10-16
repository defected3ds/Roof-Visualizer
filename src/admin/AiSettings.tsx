import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { imageLimit, promptLimit, PROVIDER_TYPES } from '../lib/models';
import { buildModelPrompt, DEFAULT_SYSTEM_PROMPT, type ImageRoles } from '../lib/prompt';
import { productThumb } from '../lib/swatch';
import { orientedPreview } from '../lib/depth';
import { mergeMasks } from '../lib/roofmask';
import type { AiSettings, AiSettingsView, Catalog, ProviderConfig, ProviderType } from '../types';
import { api, fieldClass, type SaveResult } from './Admin';

/** What a model receives, from its image limit (see src/lib/models.ts). */
function supportText(cfg: ProviderConfig): string {
  if (cfg.type === 'demo') return 'Does not call any AI: runs the whole pipeline (depth map, roof mask, prompt) but returns the photo unchanged.';
  const n = imageLimit(cfg);
  return n === 1
    ? 'Takes one image: receives the house photo and the text prompt only (no depth map, roof mask or product photos).'
    : `Takes up to ${n} images: house photo, depth map, roof mask and product photos (in that order of priority).`;
}


/** Admin tab: system prompt, what the AI receives, and which image model is active. */
export function AiSettingsEditor({ password, catalog, onSaved }: { password: string; catalog: Catalog; onSaved: (r: SaveResult) => void }) {
  const [loaded, setLoaded] = useState<AiSettingsView | null>(null);
  const [draft, setDraft] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<AiSettingsView>(password, 'GET', '/api/admin/ai')
      .then((res) => {
        setLoaded(res);
        setDraft(res.settings);
      })
      .catch((err) => setError(err.message));
  }, [password]);

  if (!draft || !loaded) return <p className="mt-6 text-muted">{error || 'Loading…'}</p>;

  const set = (patch: Partial<AiSettings>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setInclude = (patch: Partial<AiSettings['include']>) => set({ include: { ...draft.include, ...patch } });
  const setProvider = (i: number, patch: Partial<ProviderConfig>) =>
    set({ providers: draft.providers.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  async function save() {
    setBusy(true);
    setError('');
    try {
      const res = await api<SaveResult & AiSettingsView>(password, 'PUT', '/api/admin/ai', draft);
      setLoaded((l) => (l ? { ...l, settings: res.settings, keyStatus: res.keyStatus, segmentationKey: res.segmentationKey } : l));
      setDraft(res.settings);
      onSaved(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const active = draft.providers.find((p) => p.id === draft.activeProvider) ?? draft.providers[0];
  const activeLimit = imageLimit(active);

  return (
    <section className="mt-6 space-y-10">
      <p className="text-muted">
        How the roof images are made: the <strong className="text-ink">system prompt</strong> (general instructions) is combined with
        the selected <strong className="text-ink">product data</strong>, the customer&apos;s photo, its <strong className="text-ink">depth map</strong>{' '}
        and <strong className="text-ink">roof mask</strong>, and the product photos, and sent to the active image model.
      </p>

      {/* ---- Image model ---- */}
      <div>
        <h2 className="border-b border-line pb-2 text-lg font-bold">Image model</h2>
        <p className="mt-2 text-sm text-muted">
          Choose which AI makes the images. API keys are not entered here (settings are saved to GitHub); add them in Render →
          Environment under the variable name shown, e.g. <code>GEMINI_API_KEY</code>.
        </p>
        <div className="mt-4 space-y-3">
          {draft.providers.map((p, i) => {
            const isActive = p.id === draft.activeProvider;
            const saved = loaded.settings.providers.find((x) => x.id === p.id);
            const keyKnown = saved && saved.keyEnv === p.keyEnv;
            const keySet = p.type === 'demo' || (keyKnown && loaded.keyStatus[p.id]);
            return (
              <div key={p.id || i} className={`rounded-wb border p-4 ${isActive ? 'border-brand shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line'}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 font-semibold">
                    <input type="radio" name="active-provider" checked={isActive} onChange={() => set({ activeProvider: p.id })} className="accent-[var(--color-brand)]" />
                    {isActive ? 'Active' : 'Use this model'}
                  </label>
                  <span className="flex-1" />
                  {p.type !== 'demo' &&
                    (keySet ? (
                      <span className="flex items-center gap-1 text-xs font-semibold text-ink">
                        <Check size={14} /> Key {p.keyEnv} is set
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs font-semibold text-brand">
                        <TriangleAlert size={14} /> {keyKnown ? `Key ${p.keyEnv} missing on the server` : 'Save to check the key'}
                      </span>
                    ))}
                  <button
                    type="button"
                    onClick={() => set({ providers: draft.providers.filter((_, j) => j !== i) })}
                    disabled={draft.providers.length === 1}
                    title="Remove this model"
                    className="p-1 text-brand disabled:text-muted disabled:opacity-40"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-semibold">
                    Name
                    <input value={p.label} onChange={(e) => setProvider(i, { label: e.target.value })} className={fieldClass} />
                  </label>
                  <label className="block text-sm font-semibold">
                    API
                    <select
                      value={p.type}
                      onChange={(e) => {
                        const type = e.target.value as ProviderType;
                        const info = PROVIDER_TYPES[type];
                        setProvider(i, { type, model: info.defaultModel, keyEnv: info.defaultKeyEnv });
                      }}
                      className={fieldClass}
                    >
                      {(Object.keys(PROVIDER_TYPES) as ProviderType[]).map((t) => (
                        <option key={t} value={t}>
                          {PROVIDER_TYPES[t].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {p.type !== 'demo' && (
                    <>
                      <label className="block text-sm font-semibold">
                        Model
                        <input value={p.model} onChange={(e) => setProvider(i, { model: e.target.value })} className={`${fieldClass} font-mono text-sm`} />
                      </label>
                      <label className="block text-sm font-semibold">
                        API key variable (in Render → Environment)
                        <input
                          value={p.keyEnv}
                          onChange={(e) => setProvider(i, { keyEnv: e.target.value.toUpperCase() })}
                          className={`${fieldClass} font-mono text-sm`}
                        />
                      </label>
                    </>
                  )}
                </div>
                {PROVIDER_TYPES[p.type].help && <p className="mt-2 text-xs text-muted">Model: {PROVIDER_TYPES[p.type].help}</p>}
                <p className="mt-1 text-xs text-muted">{supportText(p)}</p>
                {p.type !== 'demo' && <OwnPrompt provider={p} general={draft.systemPrompt} onChange={(systemPrompt) => setProvider(i, { systemPrompt })} />}
                {p.type !== 'demo' && <TestModel password={password} provider={p} catalog={catalog} />}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() =>
            set({
              providers: [
                ...draft.providers,
                { id: '', label: 'New image model', type: 'gemini', model: PROVIDER_TYPES.gemini.defaultModel, keyEnv: PROVIDER_TYPES.gemini.defaultKeyEnv },
              ],
            })
          }
          className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-brand"
        >
          <Plus size={16} /> Add image model
        </button>
      </div>

      {/* ---- System prompt ---- */}
      <div>
        <div className="flex items-end justify-between gap-4 border-b border-line pb-2">
          <h2 className="text-lg font-bold">System prompt</h2>
          {draft.systemPrompt.trim() !== DEFAULT_SYSTEM_PROMPT && (
            <button type="button" onClick={() => set({ systemPrompt: DEFAULT_SYSTEM_PROMPT })} className="flex items-center gap-1 text-sm font-semibold text-brand">
              <RotateCcw size={14} /> Restore default
            </button>
          )}
        </div>
        <p className="mt-2 text-sm text-muted">
          The general instructions, the same for every product. Write <code>{'{{product}}'}</code> where the selected product&apos;s data
          goes and <code>{'{{images}}'}</code> where the description of the attached images goes; if you leave them out they are added
          at the end.
        </p>
        <textarea
          value={draft.systemPrompt}
          onChange={(e) => set({ systemPrompt: e.target.value })}
          rows={16}
          className={`${fieldClass} font-mono text-[13px] leading-relaxed`}
        />
      </div>

      {/* ---- What the AI receives ---- */}
      <div>
        <h2 className="border-b border-line pb-2 text-lg font-bold">What the AI receives</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Toggle label="Product description and category note" checked={draft.include.productData} onChange={(v) => setInclude({ productData: v })} />
          <Toggle label="Technical data sheet" checked={draft.include.specs} onChange={(v) => setInclude({ specs: v })} />
          <Toggle label="Depth map of the photo (3D shape)" checked={draft.include.depthMap} onChange={(v) => setInclude({ depthMap: v })} />
          <Toggle label="Roof mask (roof segmentation)" checked={draft.include.roofMask} onChange={(v) => setInclude({ roofMask: v })} />
          <div className="flex items-center gap-3">
            <Toggle label="Product photos, up to" checked={draft.include.productPhotos} onChange={(v) => setInclude({ productPhotos: v })} />
            <select
              value={draft.maxProductPhotos}
              onChange={(e) => set({ maxProductPhotos: Number(e.target.value) })}
              disabled={!draft.include.productPhotos}
              className="rounded-wb border border-line bg-white px-2 py-1.5 text-sm"
            >
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-3 text-sm font-semibold">
            Results per generation
            <select value={draft.variants} onChange={(e) => set({ variants: Number(e.target.value) })} className="rounded-wb border border-line bg-white px-2 py-1.5 text-sm font-normal">
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        {activeLimit === 1 && (
          <p className="mt-3 text-sm text-brand">The active model ({active.label}) only receives the house photo and the text prompt.</p>
        )}
      </div>

      {/* ---- Roof mask tool ---- */}
      <RoofMaskTool draft={draft} loaded={loaded} set={set} password={password} />

      {/* ---- Depth map tool ---- */}
      <DepthTool draft={draft} loaded={loaded} set={set} password={password} />

      {/* ---- Loading screen ---- */}
      <div>
        <h2 className="border-b border-line pb-2 text-lg font-bold">While generating</h2>
        <p className="mt-2 text-sm text-muted">
          What customers see while they wait. Depth map and roof mask are shown when they are sent to the AI. Line and
          edge maps are for display only and are never sent to the AI.
        </p>
        <div className="mt-4">
          <Toggle label="Show line and edge maps of the photo" checked={draft.showEdgeMaps} onChange={(v) => set({ showEdgeMaps: v })} />
        </div>
      </div>

      <FinalPromptPreview draft={draft} catalog={catalog} limit={activeLimit} model={active} />

      {error && <p className="text-sm font-semibold text-brand">{error}</p>}
      <div className="sticky bottom-0 flex gap-3 border-t border-line bg-white py-4">
        <SecondaryButton onClick={() => setDraft(loaded.settings)} disabled={busy} className="sm:w-40">
          Undo changes
        </SecondaryButton>
        <PrimaryButton onClick={save} disabled={busy} className="sm:w-56">
          {busy ? 'Saving…' : 'Save AI settings'}
        </PrimaryButton>
      </div>
    </section>
  );
}

function RoofMaskTool({
  draft,
  loaded,
  set,
  password,
}: {
  draft: AiSettings;
  loaded: AiSettingsView;
  set: (patch: Partial<AiSettings>) => void;
  password: string;
}) {
  const seg = draft.segmentation;
  const setSeg = (patch: Partial<AiSettings['segmentation']>) => set({ segmentation: { ...seg, ...patch } });
  const keyKnown = loaded.settings.segmentation.keyEnv === seg.keyEnv;
  const keySet = keyKnown && loaded.segmentationKey;
  return (
    <div>
      <h2 className="border-b border-line pb-2 text-lg font-bold">Roof mask tool</h2>
      <p className="mt-2 text-sm text-muted">
        How the roof is found in the customer&apos;s photo. SAM 3 gives sharp, accurate roof outlines; if it fails, the app
        uses CLIPSeg automatically.
      </p>
      <div className="mt-4 space-y-3">
        {(
          [
            ['sam3', 'Meta SAM 3 on fal.ai', 'Sharp and accurate. About $0.005 per photo, needs a fal.ai key.'],
            ['clipseg', 'CLIPSeg in the browser', 'Free, runs on the customer’s device. Rough edges, can miss parts of the roof.'],
          ] as const
        ).map(([tool, label, help]) => (
          <label
            key={tool}
            className={`flex cursor-pointer gap-3 rounded-wb border p-4 ${seg.tool === tool ? 'border-brand shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line'}`}
          >
            <input type="radio" name="mask-tool" checked={seg.tool === tool} onChange={() => setSeg({ tool })} className="mt-1 accent-[var(--color-brand)]" />
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="block text-sm text-muted">{help}</span>
            </span>
          </label>
        ))}
      </div>
      {seg.tool === 'sam3' && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            API key variable (in Render → Environment)
            <input value={seg.keyEnv} onChange={(e) => setSeg({ keyEnv: e.target.value.toUpperCase() })} className={`${fieldClass} font-mono`} />
            {keySet ? (
              <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-ink">
                <Check size={14} /> Key {seg.keyEnv} is set
              </span>
            ) : (
              <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-brand">
                <TriangleAlert size={14} /> {keyKnown ? `Key ${seg.keyEnv} missing on the server: CLIPSeg is used` : 'Save to check the key'}
              </span>
            )}
          </label>
          <label className="block text-sm font-semibold">
            What to find
            <input value={seg.prompt} onChange={(e) => setSeg({ prompt: e.target.value })} className={fieldClass} />
            <span className="mt-1 block text-xs font-normal text-muted">A short phrase in English, e.g. &quot;roof&quot;.</span>
          </label>
        </div>
      )}
      {seg.tool === 'sam3' && <TestRoofMask password={password} segmentation={seg} />}
      {!draft.include.roofMask && <p className="mt-3 text-sm text-brand">The roof mask is switched off under “What the AI receives”.</p>}
    </div>
  );
}

/** Optional system prompt for one model, e.g. a shorter one for a model with a prompt limit (Krea 3: 5,000). */
function OwnPrompt({ provider, general, onChange }: { provider: ProviderConfig; general: string; onChange: (v: string) => void }) {
  const limit = promptLimit(provider);
  const own = provider.systemPrompt ?? '';
  const [open, setOpen] = useState(Boolean(own) || Boolean(limit));
  return (
    <div className="mt-3 border-t border-line pt-3">
      <button type="button" onClick={() => setOpen(!open)} className="text-xs font-semibold text-brand">
        {open ? '▾' : '▸'} Own system prompt for this model {own ? '(in use)' : '(optional)'}
      </button>
      {limit && (
        <p className="mt-1 text-xs text-muted">
          This model accepts at most {limit.toLocaleString()} characters in total (system prompt + product data + image guide, about
          1,500–2,000). Longer prompts are shortened automatically; a system prompt of up to about 3,000 characters fits.
        </p>
      )}
      {open && (
        <>
          <textarea
            value={own}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            placeholder="Empty = use the general system prompt below."
            className={`${fieldClass} font-mono text-[12px] leading-relaxed`}
          />
          <div className="mt-1 flex items-center gap-3 text-xs text-muted">
            <span>
              {own.length.toLocaleString()} characters{!own && ` (general prompt: ${general.length.toLocaleString()})`}
            </span>
            {!own && (
              <button type="button" onClick={() => onChange(general)} className="font-semibold text-brand">
                Copy the general prompt here to shorten it
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** One real generation with this model card (as edited, saving not needed): start photo + a product. */
function TestModel({ password, provider, catalog }: { password: string; provider: ProviderConfig; catalog: Catalog }) {
  const withPhotos = catalog.products.filter((p) => p.images.length);
  const [productId, setProductId] = useState(
    (withPhotos.find((p) => /actua multiblend/i.test(p.name)) ?? withPhotos[0] ?? catalog.products[0])?.id ?? '',
  );
  const [state, setState] = useState<{ busy?: boolean; image?: string; info?: string; error?: string }>({});
  async function test() {
    setState({ busy: true });
    try {
      const texts = await (await fetch('/api/texts')).json().catch(() => ({}));
      const photo = await toDataUrl(texts['start.image'] || '/hero.jpg');
      const res = await api<{ image: string; ms: number; imagesSent: number }>(password, 'POST', '/api/admin/test-model', { provider, image: photo, productId });
      setState({ image: res.image, info: `Works: ${(res.ms / 1000).toFixed(1)} s, ${res.imagesSent} images sent (photo + product photos).` });
    } catch (err: any) {
      setState({ error: err.message });
    }
  }
  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={test}
          disabled={state.busy || !productId}
          className="rounded-wb border border-brand px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-brand disabled:opacity-50"
        >
          {state.busy ? 'Generating… (up to 2 min)' : 'Test this model'}
        </button>
        <span className="text-xs text-muted">on the start photo with</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className="rounded-wb border border-line bg-white px-2 py-1 text-xs">
          {withPhotos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.brand} {p.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">(one paid generation)</span>
      </div>
      {state.info && (
        <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-ink">
          <Check size={14} /> {state.info}
        </p>
      )}
      {state.error && <p className="mt-2 break-words text-xs font-semibold text-brand">Not working: {state.error}</p>}
      {state.image && <img src={state.image} alt="Test result" className="mt-2 w-full max-w-md rounded-wb border border-line" />}
    </div>
  );
}

function DepthTool({
  draft,
  loaded,
  set,
  password,
}: {
  draft: AiSettings;
  loaded: AiSettingsView;
  set: (patch: Partial<AiSettings>) => void;
  password: string;
}) {
  const d = draft.depthEstimation;
  const setD = (patch: Partial<AiSettings['depthEstimation']>) => set({ depthEstimation: { ...d, ...patch } });
  const keyKnown = loaded.settings.depthEstimation.keyEnv === d.keyEnv;
  const keySet = keyKnown && loaded.depthKey;
  return (
    <div>
      <h2 className="border-b border-line pb-2 text-lg font-bold">Depth map tool</h2>
      <p className="mt-2 text-sm text-muted">
        How the 3D shape of the photo is read. The fal.ai models make a finer map on the server; if one fails, the app uses the browser model automatically.
      </p>
      <div className="mt-4 space-y-3">
        {(
          [
            ['marigold', 'Marigold on fal.ai', 'Finest detail, made on the server. fal.ai bills $0.000575 per compute second (see the test for the time).'],
            ['midas', 'MiDaS on fal.ai (fal-ai/imageutils/depth)', 'Classic depth model, made on the server. Usually faster; check the price on the fal.ai model page.'],
            ['browser', 'Depth Anything V2 in the browser', 'Free, runs on the visitor’s device. Coarse map.'],
          ] as const
        ).map(([tool, label, help]) => (
          <label
            key={tool}
            className={`flex cursor-pointer gap-3 rounded-wb border p-4 ${d.tool === tool ? 'border-brand shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line'}`}
          >
            <input type="radio" name="depth-tool" checked={d.tool === tool} onChange={() => setD({ tool })} className="mt-1 accent-[var(--color-brand)]" />
            <span>
              <span className="block font-semibold">{label}</span>
              <span className="block text-sm text-muted">{help}</span>
            </span>
          </label>
        ))}
      </div>
      {d.tool !== 'browser' && (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-semibold">
              API key variable (in Render → Environment)
              <input value={d.keyEnv} onChange={(e) => setD({ keyEnv: e.target.value.toUpperCase() })} className={`${fieldClass} font-mono`} />
              {keySet ? (
                <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-ink">
                  <Check size={14} /> Key {d.keyEnv} is set
                </span>
              ) : (
                <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-brand">
                  <TriangleAlert size={14} /> {keyKnown ? `Key ${d.keyEnv} missing on the server: the browser model is used` : 'Save to check the key'}
                </span>
              )}
            </label>
            {d.tool === 'marigold' && (
              <label className="block text-sm font-semibold">
                Quality
                <select value={d.quality} onChange={(e) => setD({ quality: e.target.value as typeof d.quality })} className={fieldClass}>
                  <option value="fast">Fast (5 steps, 3 predictions)</option>
                  <option value="balanced">Balanced (10 steps, 5 predictions)</option>
                  <option value="best">Best (10 steps, 10 predictions, larger)</option>
                </select>
                <span className="mt-1 block text-xs font-normal text-muted">More steps and predictions: finer, slower, a little more expensive.</span>
              </label>
            )}
          </div>
          <TestDepth password={password} depthEstimation={d} />
        </>
      )}
    </div>
  );
}

/** Runs Marigold on the start photo: shows the depth map, the time and what it cost. */
function TestDepth({ password, depthEstimation }: { password: string; depthEstimation: AiSettings['depthEstimation'] }) {
  const [state, setState] = useState<{ busy?: boolean; image?: string; info?: string; error?: string }>({});
  async function test() {
    setState({ busy: true });
    try {
      const texts = await (await fetch('/api/texts')).json().catch(() => ({}));
      const photo = await toDataUrl(texts['start.image'] || '/hero.jpg');
      const res = await api<{ image: string; ms: number }>(password, 'POST', '/api/admin/test-depth', { image: photo, depthEstimation });
      const seconds = res.ms / 1000;
      setState({
        image: await orientedPreview(res.image),
        info:
          depthEstimation.tool === 'marigold'
            ? `Works: ${seconds.toFixed(1)} s, about $${(seconds * 0.000575).toFixed(4)} for this photo.`
            : `Works: ${seconds.toFixed(1)} s. (Price: see the model page on fal.ai.)`,
      });
    } catch (err: any) {
      setState({ error: err.message });
    }
  }
  return (
    <div className="mt-4">
      <SecondaryButton onClick={test} disabled={state.busy} className="sm:w-72">
        {state.busy ? 'Testing… (up to 1 min)' : `Test ${depthEstimation.tool === 'midas' ? 'MiDaS' : 'Marigold'} on the start photo`}
      </SecondaryButton>
      {state.info && (
        <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-ink">
          <Check size={14} /> {state.info}
        </p>
      )}
      {state.error && <p className="mt-2 break-words text-sm font-semibold text-brand">Not working: {state.error}</p>}
      {state.image && (
        <>
          <img src={state.image} alt="Depth map" className="mt-3 w-full max-w-md rounded-wb border border-line" />
          <p className="mt-1 text-xs text-muted">Brighter = closer to the camera, as the AI is told.</p>
        </>
      )}
    </div>
  );
}

/** Runs SAM 3 on the start screen photo, so the admin can see that the fal.ai key works and how good the mask is. */
function TestRoofMask({ password, segmentation }: { password: string; segmentation: AiSettings['segmentation'] }) {
  const [state, setState] = useState<{ busy?: boolean; overlay?: string; info?: string; error?: string }>({});
  async function test() {
    setState({ busy: true });
    try {
      const texts = await (await fetch('/api/texts')).json().catch(() => ({}));
      const photo = await toDataUrl(texts['start.image'] || '/hero.jpg');
      const res = await api<{ masks: string[]; ms: number }>(password, 'POST', '/api/admin/test-roof-mask', { image: photo, segmentation });
      const result = await mergeMasks(photo, res.masks);
      if (!result) return setState({ error: `SAM 3 answered in ${(res.ms / 1000).toFixed(1)} s but found no roof (${res.masks.length} masks).` });
      setState({ overlay: result.overlay, info: `Works: ${res.masks.length} roof mask(s) in ${(res.ms / 1000).toFixed(1)} s.` });
    } catch (err: any) {
      setState({ error: err.message });
    }
  }
  return (
    <div className="mt-4">
      <SecondaryButton onClick={test} disabled={state.busy} className="sm:w-64">
        {state.busy ? 'Testing…' : 'Test SAM 3 on the start photo'}
      </SecondaryButton>
      {state.info && (
        <p className="mt-2 flex items-center gap-1 text-sm font-semibold text-ink">
          <Check size={14} /> {state.info}
        </p>
      )}
      {state.error && <p className="mt-2 text-sm font-semibold text-brand">Not working: {state.error}</p>}
      {state.overlay && <img src={state.overlay} alt="Roof found by SAM 3" className="mt-3 w-full max-w-md rounded-wb border border-line" />}
    </div>
  );
}

/** Loads an image URL as a JPEG data URL, at most 1536 px. */
async function toDataUrl(src: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not load the start photo'));
    i.src = src;
  });
  const scale = Math.min(1, 1536 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 text-sm font-semibold">
      <span className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-brand' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      {label}
    </label>
  );
}

/** General prompt + product data = final prompt, for any product, exactly as the model will receive it. */
function FinalPromptPreview({ draft, catalog, limit, model }: { draft: AiSettings; catalog: Catalog; limit: number; model: ProviderConfig }) {
  const [productId, setProductId] = useState(catalog.products.find((p) => p.images.length)?.id ?? catalog.products[0]?.id ?? '');
  const product = catalog.products.find((p) => p.id === productId);
  const category = catalog.categories.find((c) => c.id === product?.category);

  const roles: ImageRoles = useMemo(() => {
    // Same priority as the server: house photo, depth map, roof mask, product photos, until the model's limit.
    let room = limit - 1;
    const take = (wanted: boolean) => (wanted && room > 0 ? (room--, true) : false);
    const depth = take(draft.include.depthMap);
    const mask = take(draft.include.roofMask);
    const available = draft.include.productPhotos ? Math.min(draft.maxProductPhotos, product?.images.length ?? 0) : 0;
    const photos = Math.min(available, Math.max(0, room));
    room -= photos;
    const swatch = take(draft.include.productPhotos && (product?.images.length ?? 0) === 0);
    return { depth, mask, productPhotos: photos, swatch };
  }, [draft, product, limit]);

  if (!product) return null;
  const { prompt, shortened } = buildModelPrompt(draft, model, product, category, roles);
  const maxChars = promptLimit(model);
  const images = [
    'House photo',
    ...(roles.depth ? ['Depth map'] : []),
    ...(roles.mask ? ['Roof mask'] : []),
    ...Array.from({ length: roles.productPhotos }, (_, i) => `Product photo ${i + 1}`),
    ...(roles.swatch ? ['Texture sample'] : []),
  ];

  return (
    <div>
      <h2 className="border-b border-line pb-2 text-lg font-bold">Final prompt preview</h2>
      <p className="mt-2 text-sm text-muted">
        System prompt + product data, exactly as the active model ({model.label}) receives it (unsaved changes included).
      </p>
      <label className="mt-4 block text-sm font-semibold">
        Product
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className={fieldClass}>
          {catalog.categories.map((c) => (
            <optgroup key={c.id} label={c.name}>
              {catalog.products
                .filter((p) => p.category === c.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.brand, p.name].filter(Boolean).join(' ')}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-wb border border-line bg-paper p-4 font-mono text-[12.5px] leading-relaxed text-ink">
          {prompt}
        </pre>
        <div>
          <p className="text-sm font-semibold">Images sent, in order</p>
          <ol className="mt-2 space-y-1.5 text-sm">
            {images.map((label, i) => (
              <li key={label} className="flex items-center gap-2">
                <span className="w-5 font-bold text-brand">{i + 1}</span>
                {label.startsWith('Product photo') ? (
                  <img src={product.images[Number(label.slice(-1)) - 1]} alt="" className="h-8 w-8 rounded-wb border border-line object-cover" />
                ) : label === 'Texture sample' ? (
                  <img src={productThumb(product, 64)} alt="" className="h-8 w-8 rounded-wb border border-line object-cover" />
                ) : null}
                {label}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-xs text-muted">
            {prompt.length.toLocaleString()} characters{maxChars ? ` (limit ${maxChars.toLocaleString()})` : ''}
          </p>
          {shortened && (
            <p className="mt-1 text-xs font-semibold text-brand">
              Shortened to fit this model: the end of the system prompt is left out. Write a shorter prompt for this model on its card.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
