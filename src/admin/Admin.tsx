import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Lock, Plus, Star, Trash2, X } from 'lucide-react';
import { Header, PrimaryButton, SecondaryButton, Shell, Tag } from '../components/ui';
import { fileToDataUrl } from '../lib/image';
import { productThumb } from '../lib/swatch';
import { CATEGORIES } from '../materials';
import type { Category, Product, ProductInput } from '../types';

const PASSWORD_KEY = 'roof-visualizer:admin-password';
const MAX_PHOTOS = 6;
const AI_PHOTOS = 3;

const DESCRIPTION_TEMPLATE = `Shape / profile:
Colour:
Surface finish:
Size / format:
Laying pattern:
Other details: `;

function readPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? '';
  } catch {
    return '';
  }
}

async function api<T>(password: string, method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'X-Admin-Password': password, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data as T;
}

interface SaveResult {
  product?: Product;
  synced: boolean;
  warning?: string;
}

export default function Admin() {
  const [password, setPassword] = useState(readPassword);
  const [session, setSession] = useState<{ githubSync: boolean } | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null);

  async function login(pw: string) {
    const res = await api<{ githubSync: boolean }>(pw, 'POST', '/api/admin/login');
    try {
      sessionStorage.setItem(PASSWORD_KEY, pw);
    } catch {}
    setPassword(pw);
    setSession(res);
    setProducts(await api<Product[]>(pw, 'GET', '/api/products'));
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

  if (!session) return <AdminLogin onLogin={login} />;

  async function onSaved(result: SaveResult, deletedId?: string) {
    setProducts(await api<Product[]>(password, 'GET', '/api/products'));
    setEditing(null);
    setNotice(
      result.warning
        ? { text: result.warning, warn: true }
        : { text: deletedId ? 'Product deleted.' : 'Saved. The product is in the app now and stored in GitHub.' },
    );
  }

  if (editing) {
    return (
      <ProductForm
        password={password}
        product={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={onSaved}
      />
    );
  }

  return (
    <Shell wide>
      <Header
        right={
          <button onClick={logout} className="text-sm font-semibold text-brand">
            Sign out
          </button>
        }
      />
      <div className="px-5 pb-10 pt-8">
        <Tag>Product admin</Tag>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-bold leading-tight">Roof products</h1>
            <p className="mt-1 text-muted">These are the materials customers can choose in the app.</p>
          </div>
          <div>
            <PrimaryButton onClick={() => setEditing('new')} className="px-6">
              <Plus size={18} /> Add product
            </PrimaryButton>
          </div>
        </div>

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

        {CATEGORIES.map((category) => {
          const items = products.filter((p) => p.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="mt-8">
              <h2 className="border-b border-line pb-2 text-lg font-bold">{category}</h2>
              <ul className="divide-y divide-dotted divide-line">
                {items.map((p) => (
                  <li key={p.id}>
                    <button onClick={() => setEditing(p)} className="flex w-full items-center gap-4 py-3 text-left hover:bg-paper">
                      <img src={productThumb(p, 120)} alt="" className="h-14 w-14 shrink-0 rounded-wb border border-line object-cover" />
                      <span className="min-w-0 flex-1">
                        {p.brand && <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{p.brand}</span>}
                        <span className="block truncate font-semibold">{p.name}</span>
                        <span className="block truncate text-sm text-muted">{p.description}</span>
                      </span>
                      <span className={`shrink-0 text-xs ${p.images.length ? 'text-ink' : 'text-muted'}`}>
                        {p.images.length ? `${p.images.length} photo${p.images.length > 1 ? 's' : ''}` : 'No photos'}
                      </span>
                      <ArrowRight size={18} className="shrink-0 text-brand" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <a href="/" className="mt-10 inline-flex items-center gap-2 text-sm font-semibold text-brand">
          <ArrowLeft size={16} /> Back to the app
        </a>
      </div>
    </Shell>
  );
}

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
          <Tag>Product admin</Tag>
          <h1 className="mt-4 text-[32px] font-bold leading-tight">Manage roof products</h1>
          <p className="mt-3 leading-relaxed text-muted">Sign in with the admin password to add or change products.</p>
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

function ProductForm({
  password,
  product,
  onCancel,
  onSaved,
}: {
  password: string;
  product: Product | null;
  onCancel: () => void;
  onSaved: (result: SaveResult, deletedId?: string) => void;
}) {
  const [name, setName] = useState(product?.name ?? '');
  const [brand, setBrand] = useState(product?.brand ?? '');
  const [category, setCategory] = useState<Category>(product?.category ?? 'Tile');
  const [description, setDescription] = useState(product?.description ?? '');
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

  function makeMain(i: number) {
    setImages((prev) => [prev[i], ...prev.filter((_, j) => j !== i)]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body: ProductInput = { id: product?.id, name, brand, category, description, images };
      onSaved(await api<SaveResult>(password, 'POST', '/api/admin/products', body));
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!product || !confirm(`Delete "${product.name}"? Customers will no longer be able to choose it.`)) return;
    setBusy(true);
    try {
      onSaved(await api<SaveResult>(password, 'DELETE', `/api/admin/products/${encodeURIComponent(product.id)}`), product.id);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  const fieldClass = 'mt-2 w-full rounded-wb border border-line bg-white px-3 py-2.5 outline-none focus:border-brand';

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
                    <button type="button" onClick={() => makeMain(i)} title="Make main photo" className="rounded-wb bg-white/90 p-1 text-ink">
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
          <label className="block text-sm font-semibold">
            Category *
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={fieldClass}>
              {CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
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
            S-shaped pantile, beaver tail…), exact colour and colour variation, surface (matte, engobed, glazed), size or
            tiles per m², laying pattern, and visible details such as ridge tiles. Skip marketing words; the AI only uses
            what can be seen.
          </p>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={7}
            required
            placeholder="Flat interlocking clay tile with a single central rib. Copper-brown engobe with a slight natural colour variation, matte finish. Large format, about 13 tiles per m². Laid in straight vertical lines. Matching rounded ridge tiles."
            className={`${fieldClass} leading-relaxed`}
          />
        </section>

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
          <PrimaryButton type="submit" disabled={busy} className="sm:w-48">
            {busy ? 'Saving…' : 'Save product'}
          </PrimaryButton>
        </div>
      </form>
    </Shell>
  );
}
