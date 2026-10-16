import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { imageLimit, PROVIDER_TYPES } from '../lib/models';
import { buildFinalPrompt, DEFAULT_SYSTEM_PROMPT, type ImageRoles } from '../lib/prompt';
import { productThumb } from '../lib/swatch';
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
      const res = await api<SaveResult & { settings: AiSettings; keyStatus: Record<string, boolean> }>(password, 'PUT', '/api/admin/ai', draft);
      setLoaded((l) => (l ? { ...l, settings: res.settings, keyStatus: res.keyStatus } : l));
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

      <FinalPromptPreview draft={draft} catalog={catalog} limit={activeLimit} />

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
function FinalPromptPreview({ draft, catalog, limit }: { draft: AiSettings; catalog: Catalog; limit: number }) {
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
  const prompt = buildFinalPrompt(draft, product, category, roles);
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
      <p className="mt-2 text-sm text-muted">System prompt + product data, exactly as the model receives it (unsaved changes included).</p>
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
          <p className="mt-3 text-xs text-muted">{prompt.length.toLocaleString()} characters</p>
        </div>
      </div>
    </div>
  );
}
