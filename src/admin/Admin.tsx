import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  ImagePlus,
  ListPlus,
  Lock,
  Plus,
  RotateCcw,
  Star,
  Trash2,
  X,
  LayoutGrid,
  List,
} from 'lucide-react';
import { Header, PrimaryButton, SecondaryButton, Shell, Tag } from '../components/ui';
import { AiSettingsEditor } from './AiSettings';
import { CostsTab } from './Costs';
import { fileToDataUrl } from '../lib/image';
import { productThumb } from '../lib/swatch';
import { DEFAULT_TEXTS, TEXT_GROUPS } from '../texts';
import type { Catalog, Category, Product, ProductInput, Spec, Texts } from '../types';

const PASSWORD_KEY = 'roof-visualizer:admin-password';
const MAX_PHOTOS = 6;
const AI_PHOTOS = 3;

const DESCRIPTION_TEMPLATE = `Shape / profile:
Colour:
Surface finish:
Laying pattern:
Other details: `;

/** Rows offered by "Add common fields" (the usual roof tile data sheet). */
const COMMON_SPECS = [
  'Material',
  'Overall dimensions',
  'Effective covering width',
  'Covering length',
  'Tiles per m²',
  'Weight per tile',
  'Roof weight',
  'Installation',
  'Colors',
];

type Tab = 'products' | 'categories' | 'texts' | 'ai' | 'costs';

export interface SaveResult {
  synced: boolean;
  warning?: string;
}

function readPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

export async function api<T>(password: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'X-Admin-Password': password, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

/** Splits text copied from a web page, spreadsheet or PDF table into label/value rows. */
export function parseSpecTable(text: string): Spec[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.includes('\t') ? line.split(/\t+/) : line.includes(':') ? line.split(/:(.*)/s) : line.split(/\s{2,}/);
      const [label, ...rest] = parts.map((p) => p.trim()).filter(Boolean);
      return { label: label ?? '', value: rest.join(' ').trim() };
    })
    .filter((s) => s.label && !(s.label.toLowerCase() === 'property' && s.value.toLowerCase() === 'specification'));
}

export default function Admin() {
  const [password, setPassword] = useState(readPassword);
  const [session, setSession] = useState<{ githubSync: boolean } | null>(null);
  const [catalog, setCatalog] = useState<Catalog>({ categories: [], products: [] });
  const [texts, setTexts] = useState<Texts>({});
  const [tab, setTab] = useState<Tab>('products');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null);

  async function reload(pw = password) {
    const [c, t] = await Promise.all([api<Catalog>(pw, 'GET', '/api/catalog'), fetch('/api/texts').then((r) => r.json())]);
    setCatalog(c);
    setTexts(t);
  }

  async function login(pw: string) {
    const res = await api<{ githubSync: boolean }>(pw, 'POST', '/api/admin/login');
    try {
      sessionStorage.setItem(PASSWORD_KEY, pw);
    } catch {}
    setPassword(pw);
    await reload(pw);
    setSession(res);
  }

  useEffect(() => {
    if (password) login(password).catch(() => setPassword(''));
    // Only on first load, with a password remembered from earlier in this browser session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logout() {
    try {
      sessionStorage.removeItem(PASSWORD_KEY);
    } catch {}
    setPassword('');
    setSession(null);
  }

  /** Reloads the data and shows how a save went. */
  async function saved(result: SaveResult, message: string) {
    await reload();
    setNotice(result.warning ? { text: result.warning, warn: true } : { text: `${message} Stored in GitHub.` });
    window.scrollTo({ top: 0 });
  }

  if (!session) return <AdminLogin onLogin={login} />;

  if (editing) {
    return (
      <ProductForm
        password={password}
        product={editing === 'new' ? null : editing}
        categories={catalog.categories}
        onCategoriesChanged={(categories) => setCatalog((c) => ({ ...c, categories }))}
        onCancel={() => setEditing(null)}
        onSaved={async (result, message) => {
          setEditing(null);
          await saved(result, message);
        }}
      />
    );
  }

  return (
    <Shell admin>
      <Header
        right={
          <button onClick={logout} className="text-sm font-semibold text-brand">
            Sign out
          </button>
        }
      />
      <div className="px-5 pb-10 pt-8 lg:px-10">
        <Tag>Admin</Tag>
        <h1 className="mt-4 text-[30px] font-bold leading-tight">Roof Visualizer admin</h1>

        <nav className="no-scrollbar mt-6 flex gap-1 overflow-x-auto border-b border-line">
          {(
            [
              ['products', 'Products'],
              ['categories', 'Categories'],
              ['texts', 'App texts'],
              ['ai', 'AI settings'],
              ['costs', 'Costs'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                setTab(id);
                setNotice(null);
              }}
              className={`border-b-[3px] px-4 pb-2.5 pt-1 text-[15px] ${
                tab === id ? 'border-brand font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {!session.githubSync && (
          <p className="mt-6 rounded-wb border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <strong>Changes are temporary.</strong> They are kept until the app restarts or redeploys. Add a
            <code className="mx-1">GITHUB_TOKEN</code> on the server to store them permanently (see DEPLOY.md).
          </p>
        )}
        {notice && (
          <div
            className={`mt-6 flex items-start gap-3 rounded-wb border-l-4 p-4 text-sm ${
              notice.warn ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-brand bg-paper'
            }`}
          >
            <p className="flex-1">{notice.text}</p>
            <button onClick={() => setNotice(null)} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}

        {tab === 'products' && <ProductList catalog={catalog} onEdit={setEditing} />}
        {tab === 'categories' && (
          <CategoryEditor password={password} catalog={catalog} onSaved={(r) => saved(r, 'Categories saved.')} />
        )}
        {tab === 'texts' && <TextEditor password={password} texts={texts} onSaved={(r) => saved(r, 'Texts saved.')} />}
        {tab === 'costs' && <CostsTab password={password} onSaved={(r) => saved(r, 'Prices saved.')} />}
        {tab === 'ai' && <AiSettingsEditor password={password} catalog={catalog} onSaved={(r) => saved(r, 'AI settings saved.')} />}

        <a href="/" className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-brand">
          <ArrowLeft size={16} /> Back to the app
        </a>
      </div>
    </Shell>
  );
}

// ---- Sign in --------------------------------------------------------------------------------

function AdminLogin({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onLogin(value.trim());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <Header />
      <form onSubmit={submit} className="flex flex-1 flex-col justify-between px-5 pb-8 pt-8">
        <div>
          <Tag>Admin</Tag>
          <h1 className="mt-4 text-[32px] font-bold leading-tight">Manage the Roof Visualizer</h1>
          <p className="mt-3 leading-relaxed text-muted">Sign in with the admin password to change products, categories and texts.</p>
          <label className="mt-10 block text-sm font-semibold" htmlFor="admin-password">
            Admin password
          </label>
          <div className="mt-2 flex items-center gap-3 rounded-wb border border-line px-3 py-3 focus-within:border-brand">
            <Lock size={18} className="text-muted" />
            <input
              id="admin-password"
              autoFocus
              type="password"
              autoComplete="current-password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 bg-transparent text-lg outline-none"
            />
          </div>
          {error && <p className="mt-3 text-sm font-semibold text-brand">{error}</p>}
        </div>
        <PrimaryButton type="submit" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Sign in'} <ArrowRight size={20} />
        </PrimaryButton>
      </form>
    </Shell>
  );
}

// ---- Products -------------------------------------------------------------------------------

function ProductList({ catalog, onEdit }: { catalog: Catalog; onEdit: (p: Product | 'new') => void }) {
  const { categories, products } = catalog;
  const orphans = products.filter((p) => !categories.some((c) => c.id === p.category));
  const groups = [
    ...categories.map((c) => ({ key: c.id, title: c.name, items: products.filter((p) => p.category === c.id) })),
    ...(orphans.length ? [{ key: '-', title: 'Without category', items: orphans }] : []),
  ];

  // List or gallery grid; the choice is remembered in this browser.
  const [view, setView] = useState<'list' | 'grid'>(() => {
    try {
      return localStorage.getItem('rv.productView') === 'list' ? 'list' : 'grid';
    } catch {
      return 'grid';
    }
  });
  const chooseView = (v: 'list' | 'grid') => {
    setView(v);
    try {
      localStorage.setItem('rv.productView', v);
    } catch {
      /* storage blocked */
    }
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
        <p className="text-muted">These are the products customers can choose in the app.</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex shrink-0 overflow-hidden rounded-wb border border-line" role="group" aria-label="View">
            {(
              [
                ['grid', 'Gallery', LayoutGrid],
                ['list', 'List', List],
              ] as const
            ).map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => chooseView(v)}
                aria-pressed={view === v}
                className={`flex h-12 w-44 items-center justify-center gap-2 px-3 text-[15px] font-bold uppercase tracking-wide ${view === v ? 'bg-brand text-white' : 'bg-white text-muted hover:bg-paper'}`}
              >
                <Icon size={18} /> {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onEdit('new')}
            className="flex h-12 w-44 shrink-0 items-center justify-center gap-2 rounded-wb bg-brand px-3 text-[15px] font-bold uppercase tracking-wide text-white transition hover:bg-brand-dark"
          >
            <Plus size={18} /> Add product
          </button>
        </div>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="mt-8">
          <h2 className="border-b border-line pb-2 text-lg font-bold">
            {g.title} <span className="text-sm font-normal text-muted">({g.items.length})</span>
          </h2>
          {g.items.length === 0 && <p className="py-3 text-sm text-muted">No products in this category yet.</p>}
          {view === 'grid' ? (
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {g.items.map((p) => (
                <li key={p.id}>
                  <button onClick={() => onEdit(p)} className="group block w-full overflow-hidden rounded-wb border border-line bg-white text-left transition hover:border-brand">
                    <img src={productThumb(p, 360)} alt="" className="aspect-square w-full object-cover" />
                    <span className="block p-3">
                      {p.brand && <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{p.brand}</span>}
                      <span className="block truncate text-sm font-semibold group-hover:text-brand">{p.name}</span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {p.images.length ? `${p.images.length} photo${p.images.length > 1 ? 's' : ''}` : 'No photos'} · {p.specs.length ? `${p.specs.length} data rows` : 'no data'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
          <ul className="divide-y divide-dotted divide-line lg:grid lg:grid-cols-2 lg:gap-x-10 lg:divide-y-0 [&>li]:lg:border-b [&>li]:lg:border-dotted [&>li]:lg:border-line">
            {g.items.map((p) => (
              <li key={p.id}>
                <button onClick={() => onEdit(p)} className="flex w-full items-center gap-4 py-3 text-left hover:bg-paper">
                  <img src={productThumb(p, 120)} alt="" className="h-14 w-14 shrink-0 rounded-wb border border-line object-cover" />
                  <span className="min-w-0 flex-1">
                    {p.brand && <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{p.brand}</span>}
                    <span className="block truncate font-semibold">{p.name}</span>
                    <span className="block truncate text-sm text-muted">{p.description}</span>
                  </span>
                  <span className="hidden shrink-0 text-right text-xs text-muted sm:block">
                    {p.images.length ? `${p.images.length} photo${p.images.length > 1 ? 's' : ''}` : 'No photos'}
                    <br />
                    {p.specs.length ? `${p.specs.length} data rows` : 'No technical data'}
                  </span>
                  <ArrowRight size={18} className="shrink-0 text-brand" />
                </button>
              </li>
            ))}
          </ul>
          )}
        </section>
      ))}
    </>
  );
}

export const fieldClass = 'mt-2 w-full rounded-wb border border-line bg-white px-3 py-2.5 font-normal outline-none focus:border-brand';

function ProductForm({
  password,
  product,
  categories,
  onCategoriesChanged,
  onCancel,
  onSaved,
}: {
  password: string;
  product: Product | null;
  categories: Category[];
  onCategoriesChanged: (categories: Category[]) => void;
  onCancel: () => void;
  onSaved: (result: SaveResult, message: string) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [category, setCategory] = useState(product?.category ?? categories[0]?.id ?? '');
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [description, setDescription] = useState(product?.description ?? '');
  const [specs, setSpecs] = useState<Spec[]>(product?.specs ?? []);
  const [images, setImages] = useState<string[]>(product?.images ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  async function addPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const room = MAX_PHOTOS - images.length;
    if (files.length > room) setError(`A product can have at most ${MAX_PHOTOS} photos.`);
    const added = await Promise.all(files.slice(0, room).map((f) => fileToDataUrl(f, 1280)));
    setImages((prev) => [...prev, ...added]);
  }

  async function createCategory() {
    const label = newCategory?.trim();
    if (!label) return;
    setBusy(true);
    setError('');
    try {
      const res = await api<SaveResult & { categories: Category[] }>(password, 'PUT', '/api/admin/categories', [
        ...categories,
        { name: label, description: '' },
      ]);
      onCategoriesChanged(res.categories);
      setCategory(res.categories[res.categories.length - 1].id);
      setNewCategory(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body: ProductInput = { id: product?.id, name, brand, category, description, specs, images };
      onSaved(await api<SaveResult>(password, 'POST', '/api/admin/products', body), `"${name.trim()}" saved.`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!product || !confirm(`Delete "${product.name}"? Customers will no longer be able to choose it.`)) return;
    setBusy(true);
    try {
      onSaved(
        await api<SaveResult>(password, 'DELETE', `/api/admin/products/${encodeURIComponent(product.id)}`),
        `"${product.name}" deleted.`,
      );
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Shell wide>
      <Header
        left={
          <button onClick={onCancel} className="-ml-2 p-2 text-brand" aria-label="Back">
            <ArrowLeft size={24} />
          </button>
        }
      />
      <form onSubmit={save} className="px-5 pb-10 pt-8">
        <Tag>{product ? 'Edit product' : 'New product'}</Tag>
        <h1 className="mt-4 text-[28px] font-bold leading-tight">{product ? product.name : 'Add a roof product'}</h1>

        <section className="mt-8">
          <h2 className="text-lg font-bold">Photos</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Real photos make the biggest difference. Best results: a straight-on close-up of the tiles laid on a roof, a
            photo of a finished roof with this product, and a single tile. The first photo is the thumbnail; the first{' '}
            {AI_PHOTOS} are sent to the AI. Up to {MAX_PHOTOS} photos.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {images.map((src, i) => (
              <figure key={src.slice(-40) + i} className="relative overflow-hidden rounded-wb border border-line">
                <img src={src} alt="" className="aspect-square w-full object-cover" />
                <span className="absolute left-1 top-1 rounded-wb bg-white/90 px-1.5 text-[11px] font-semibold">
                  {i === 0 ? 'Main' : i < AI_PHOTOS ? 'AI' : ''}
                </span>
                <div className="absolute right-1 top-1 flex gap-1">
                  {i > 0 && (
                    <button
                      type="button"
                      onClick={() => setImages((prev) => [prev[i], ...prev.filter((_, j) => j !== i)])}
                      title="Make main photo"
                      className="rounded-wb bg-white/90 p-1 text-ink"
                    >
                      <Star size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                    title="Remove photo"
                    className="rounded-wb bg-white/90 p-1 text-brand"
                  >
                    <X size={14} />
                  </button>
                </div>
              </figure>
            ))}
            {images.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-wb border-2 border-dashed border-line text-sm font-semibold text-brand hover:border-brand"
              >
                <ImagePlus size={22} /> Add photos
              </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={addPhotos} />
          {images.length === 0 && product?.swatch && (
            <p className="mt-3 text-sm text-muted">Without photos the app uses a drawn texture, which gives less accurate results.</p>
          )}
        </section>

        <section className="mt-8 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-semibold">
            Product name *
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rubin 13V – Copper brown" className={fieldClass} required />
          </label>
          <label className="block text-sm font-semibold">
            Brand / product line
            <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="e.g. Koramic, Tondach" className={fieldClass} />
          </label>
          <div className="text-sm font-semibold">
            <label htmlFor="category">Category *</label>
            {newCategory === null ? (
              <select
                id="category"
                value={category}
                onChange={(e) => (e.target.value === '__new' ? setNewCategory('') : setCategory(e.target.value))}
                className={fieldClass}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="__new">+ New category…</option>
              </select>
            ) : (
              <div className="mt-2 flex gap-2">
                <input
                  autoFocus
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      createCategory();
                    }
                  }}
                  placeholder="New category name"
                  className={`${fieldClass} mt-0`}
                />
                <button type="button" onClick={createCategory} disabled={busy} className="rounded-wb bg-brand px-4 font-bold text-white">
                  Add
                </button>
                <button type="button" onClick={() => setNewCategory(null)} className="px-2 text-muted" aria-label="Cancel">
                  <X size={18} />
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <label htmlFor="description" className="text-lg font-bold">
              Description for the AI *
            </label>
            {!description.trim() && (
              <button type="button" onClick={() => setDescription(DESCRIPTION_TEMPLATE)} className="text-sm font-semibold text-brand">
                Use template
              </button>
            )}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Describe what the product looks like on a roof, the way a roofer would: shape or profile (flat interlocking,
            S-shaped pantile, beaver tail…), exact colour and colour variation, surface (matte, engobed, glazed), laying
            pattern, and visible details such as ridge tiles. Skip marketing words; the AI only uses what can be seen.
          </p>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            required
            placeholder="Flat interlocking clay tile with a single central rib. Copper-brown engobe with a slight natural colour variation, matte finish. Laid in straight vertical lines. Matching rounded ridge tiles."
            className={`${fieldClass} leading-relaxed`}
          />
        </section>

        <SpecEditor specs={specs} onChange={setSpecs} />

        {error && <p className="mt-5 text-sm font-semibold text-brand">{error}</p>}

        <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          {product && (
            <button type="button" onClick={remove} disabled={busy} className="flex items-center gap-2 text-sm font-semibold text-brand sm:mr-auto">
              <Trash2 size={16} /> Delete product
            </button>
          )}
          <SecondaryButton onClick={onCancel} disabled={busy} className="sm:w-40">
            Cancel
          </SecondaryButton>
          <PrimaryButton type="submit" disabled={busy || !category} className="sm:w-48">
            {busy ? 'Saving…' : 'Save product'}
          </PrimaryButton>
        </div>
      </form>
    </Shell>
  );
}

function SpecEditor({ specs, onChange }: { specs: Spec[]; onChange: (specs: Spec[]) => void }) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const update = (i: number, patch: Partial<Spec>) => onChange(specs.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  function applyPaste() {
    const rows = parseSpecTable(pasted);
    // Fill empty rows with the same label first, then append the rest.
    const next = [...specs];
    for (const row of rows) {
      const slot = next.findIndex((s) => s.label.toLowerCase() === row.label.toLowerCase());
      if (slot >= 0) next[slot] = row;
      else next.push(row);
    }
    onChange(next);
    setPasted('');
    setPasting(false);
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold">Technical data</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Dimensions, tiles per m², colours and so on. The AI uses it for the correct tile size and proportions, and customers
        can see it in the app.
      </p>

      {specs.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-wb border border-line">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 border-b border-line bg-paper px-3 py-2 text-sm font-semibold">
            <span>Property</span>
            <span>Specification</span>
            <span className="w-[72px]" />
          </div>
          {specs.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 border-b border-dotted border-line px-3 py-1.5 last:border-b-0">
              <input
                value={s.label}
                onChange={(e) => update(i, { label: e.target.value })}
                placeholder="Property"
                aria-label={`Property ${i + 1}`}
                className="min-w-0 rounded-wb border border-transparent px-2 py-1.5 hover:border-line focus:border-brand focus:outline-none"
              />
              <input
                value={s.value}
                onChange={(e) => update(i, { value: e.target.value })}
                placeholder="Specification"
                aria-label={`Specification ${i + 1}`}
                className="min-w-0 rounded-wb border border-transparent px-2 py-1.5 hover:border-line focus:border-brand focus:outline-none"
              />
              <span className="flex w-[72px] justify-end gap-1 text-muted">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => onChange(specs.map((x, j) => (j === i - 1 ? specs[i] : j === i ? specs[i - 1] : x)))}
                  title="Move up"
                  className="p-1 hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => onChange(specs.filter((_, j) => j !== i))}
                  title="Remove row"
                  className="p-1 text-brand"
                >
                  <X size={15} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold text-brand">
        <button type="button" onClick={() => onChange([...specs, { label: '', value: '' }])} className="flex items-center gap-1.5">
          <Plus size={16} /> Add row
        </button>
        {specs.length === 0 && (
          <button
            type="button"
            onClick={() => onChange(COMMON_SPECS.map((label) => ({ label, value: '' })))}
            className="flex items-center gap-1.5"
          >
            <ListPlus size={16} /> Add common fields
          </button>
        )}
        <button type="button" onClick={() => setPasting((p) => !p)} className="flex items-center gap-1.5">
          <ClipboardPaste size={16} /> Paste a table
        </button>
      </div>

      {pasting && (
        <div className="mt-3 rounded-wb border border-line bg-paper p-3">
          <p className="text-sm text-muted">
            Copy the technical data table from a product page, PDF or spreadsheet and paste it here. One property per line;
            the property and value can be separated by a tab, a colon or several spaces.
          </p>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={6}
            autoFocus
            placeholder={'Material\tFired clay (ceramic)\nOverall dimensions\t272 × 480 mm\nTiles per m²: 10.9–11.8'}
            className={`${fieldClass} font-mono text-sm`}
          />
          <div className="mt-2 flex gap-3">
            <button type="button" onClick={applyPaste} disabled={!pasted.trim()} className="rounded-wb bg-brand px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
              Add {parseSpecTable(pasted).length || ''} rows
            </button>
            <button type="button" onClick={() => setPasting(false)} className="text-sm font-semibold text-muted">
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---- Categories -----------------------------------------------------------------------------

function CategoryEditor({ password, catalog, onSaved }: { password: string; catalog: Catalog; onSaved: (r: SaveResult) => void }) {
  const [draft, setDraft] = useState<Partial<Category>[]>(catalog.categories);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = (id?: string) => catalog.products.filter((p) => p.category === id).length;
  const update = (i: number, patch: Partial<Category>) => setDraft((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const move = (i: number, by: number) =>
    setDraft((d) => {
      const next = [...d];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });

  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(await api<SaveResult>(password, 'PUT', '/api/admin/categories', draft));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <p className="text-muted">
        Categories are the filters customers see above the products (in this order). The AI note tells the AI what kind of
        roofing the category is.
      </p>
      <div className="mt-5 space-y-3">
        {draft.map((c, i) => {
          const used = count(c.id);
          return (
            <div key={c.id ?? `new-${i}`} className="rounded-wb border border-line p-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_1.4fr_auto]">
                <label className="block text-sm font-semibold">
                  Name
                  <input value={c.name ?? ''} onChange={(e) => update(i, { name: e.target.value })} className={fieldClass} />
                </label>
                <label className="block text-sm font-semibold">
                  AI note
                  <input
                    value={c.description ?? ''}
                    onChange={(e) => update(i, { description: e.target.value })}
                    placeholder="e.g. Clay or concrete roof tiles."
                    className={fieldClass}
                  />
                </label>
                <div className="flex items-end gap-1 pb-1 text-muted">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} title="Move up" className="p-2 hover:text-ink disabled:opacity-30">
                    <ArrowUp size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    disabled={i === draft.length - 1}
                    title="Move down"
                    className="p-2 hover:text-ink disabled:opacity-30"
                  >
                    <ArrowDown size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                    disabled={used > 0}
                    title={used > 0 ? 'Move or delete its products first' : 'Delete category'}
                    className="p-2 text-brand disabled:text-muted disabled:opacity-40"
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">{used === 1 ? '1 product' : `${used} products`}</p>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => setDraft((d) => [...d, { name: '', description: '' }])}
        className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-brand"
      >
        <Plus size={16} /> Add category
      </button>
      {error && <p className="mt-4 text-sm font-semibold text-brand">{error}</p>}
      <div className="mt-6 flex gap-3">
        <SecondaryButton onClick={() => setDraft(catalog.categories)} disabled={busy} className="sm:w-40">
          Undo changes
        </SecondaryButton>
        <PrimaryButton onClick={save} disabled={busy} className="sm:w-48">
          {busy ? 'Saving…' : 'Save categories'}
        </PrimaryButton>
      </div>
    </section>
  );
}

// ---- App texts ------------------------------------------------------------------------------

function TextEditor({ password, texts, onSaved }: { password: string; texts: Texts; onSaved: (r: SaveResult) => void }) {
  const [draft, setDraft] = useState<Texts>(() => ({ ...DEFAULT_TEXTS, ...texts }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(await api<SaveResult>(password, 'PUT', '/api/admin/texts', draft));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6">
      <p className="text-muted">Every text customers see in the app. Leave a field empty to use the default.</p>
      {TEXT_GROUPS.map((group) => (
        <div key={group.title} className="mt-8">
          <h2 className="border-b border-line pb-2 text-lg font-bold">{group.title}</h2>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {group.fields.map((f) => {
              const value = draft[f.key] ?? '';
              const changed = value.trim() !== f.value;
              const props = {
                value,
                onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                  setDraft((d) => ({ ...d, [f.key]: e.target.value })),
                placeholder: f.value,
                className: `${fieldClass} ${changed ? 'border-brand/50 bg-red-50/40' : ''}`,
              };
              return (
                <label key={f.key} className={`block text-sm font-semibold ${f.long || f.image ? 'sm:col-span-2' : ''}`}>
                  <span className="flex items-center justify-between gap-2">
                    {f.label}
                    {changed && (
                      <button
                        type="button"
                        onClick={() => setDraft((d) => ({ ...d, [f.key]: f.value }))}
                        className="flex items-center gap-1 text-xs font-semibold text-brand"
                      >
                        <RotateCcw size={12} /> Default
                      </button>
                    )}
                  </span>
                  {f.image ? (
                    <PhotoField value={value || f.value} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
                  ) : f.long ? (
                    <textarea rows={3} {...props} />
                  ) : (
                    <input {...props} />
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
      {error && <p className="mt-4 text-sm font-semibold text-brand">{error}</p>}
      <div className="sticky bottom-0 mt-8 flex gap-3 border-t border-line bg-white py-4">
        <SecondaryButton onClick={() => setDraft({ ...DEFAULT_TEXTS, ...texts })} disabled={busy} className="sm:w-40">
          Undo changes
        </SecondaryButton>
        <PrimaryButton onClick={save} disabled={busy} className="sm:w-48">
          {busy ? 'Saving…' : 'Save texts'}
        </PrimaryButton>
      </div>
    </section>
  );
}

function PhotoField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="mt-2 flex flex-wrap items-end gap-4 font-normal">
      <img src={value} alt="" className="aspect-[4/3] w-full max-w-sm rounded-wb border border-line object-cover" />
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          input.current?.click();
        }}
        className="flex items-center gap-1.5 text-sm font-semibold text-brand"
      >
        <ImagePlus size={16} /> Upload new photo
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onChange(await fileToDataUrl(file, 1600));
        }}
      />
    </span>
  );
}
