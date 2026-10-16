import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Columns2,
  Image as ImageIcon,
  Info,
  Lock,
  Maximize,
  Redo2,
  RefreshCw,
  Share,
  Undo2,
  X,
} from 'lucide-react';
import { MaterialPicker } from './components/MaterialPicker';
import { Stage } from './components/Stage';
import { Header, PrimaryButton, SecondaryButton, Shell, Tag } from './components/ui';
import { buildEdgeMaps, fileToDataUrl, shareImage } from './lib/image';
import { productThumb, renderSwatch } from './lib/swatch';
import { TextsProvider, useT } from './lib/texts';
import type { Catalog, Category, GenerateResponse, Product } from './types';

const VARIANTS = 3;
const CODE_KEY = 'roof-visualizer:access-code';

function storedCode(): string {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeCode(code: string) {
  try {
    if (code) localStorage.setItem(CODE_KEY, code);
    else localStorage.removeItem(CODE_KEY);
  } catch {}
}

async function checkCode(code: string): Promise<boolean> {
  const res = await fetch('/api/unlock', { method: 'POST', headers: { 'X-Access-Code': code } });
  return res.ok;
}

type Gate = 'checking' | 'locked' | 'open';

export default function App() {
  return (
    <TextsProvider>
      <RoofApp />
    </TextsProvider>
  );
}

function RoofApp() {
  const t = useT();
  const [gate, setGate] = useState<Gate>('checking');
  const [accessCode, setAccessCode] = useState(storedCode);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [edgeMaps, setEdgeMaps] = useState<string[]>([]);
  const [compare, setCompare] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const tipShown = useRef(false);

  const base = history[cursor];

  useEffect(() => {
    (async () => {
      try {
        const health = await (await fetch('/api/health')).json();
        setProvider(health.provider);
        if (!health.locked) return setGate('open');
        const saved = storedCode();
        setGate(saved && (await checkCode(saved)) ? 'open' : 'locked');
      } catch {
        setGate('open');
      }
    })();
  }, []);

  useEffect(() => {
    if (gate !== 'open') return;
    fetch('/api/catalog', { headers: { 'X-Access-Code': accessCode } })
      .then(async (res) => {
        if (res.status === 401) {
          storeCode('');
          setGate('locked');
          return;
        }
        if (!res.ok) throw new Error('Could not load the product catalog');
        const catalog = (await res.json()) as Catalog;
        setCategories(catalog.categories);
        setProducts(catalog.products);
      })
      .catch((err) => setToast(err.message));
  }, [gate, accessCode]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  function unlocked(code: string) {
    storeCode(code);
    setAccessCode(code);
    setGate('open');
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const url = await fileToDataUrl(file);
      setHistory([url]);
      setCursor(0);
      setResults([]);
      setCompare(false);
    } catch (err: any) {
      setToast(err.message);
    }
  }

  async function generate() {
    if (!base || !product || generating) return;
    setGenerating(true);
    setStartedAt(Date.now());
    setCompare(false);
    buildEdgeMaps(base).then(setEdgeMaps).catch(() => setEdgeMaps([]));
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Code': accessCode },
        body: JSON.stringify({
          image: base,
          productId: product.id,
          swatch: product.images.length ? undefined : renderSwatch(product, 384),
          count: VARIANTS,
        }),
      });
      const data = (await res.json()) as GenerateResponse & { error?: string; code?: string };
      if (res.status === 401) {
        // The access code was changed on the server: sign in again.
        storeCode('');
        setGate('locked');
        return;
      }
      if (data.code === 'limit') throw new Error(t('message.limit'));
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setResults(data.images);
      setActive(0);
      if (data.provider === 'demo') {
        setToast('Demo mode: add GEMINI_API_KEY or REPLICATE_API_TOKEN on the server to generate real roofs.');
      } else if (data.images.length > 1 && !tipShown.current) {
        tipShown.current = true;
        setToast(t('message.swipe'));
      }
    } catch (err: any) {
      setToast(err.message || t('message.error'));
    } finally {
      setGenerating(false);
      setStartedAt(null);
    }
  }

  function accept() {
    const chosen = results[active];
    if (!chosen) return;
    const next = [...history.slice(0, cursor + 1), chosen];
    setHistory(next);
    setCursor(next.length - 1);
    setResults([]);
    setCompare(false);
  }

  function step(delta: number) {
    setResults([]);
    setCompare(false);
    setCursor((c) => Math.min(history.length - 1, Math.max(0, c + delta)));
  }

  const product = products.find((p) => p.id === productId) ?? products[0];
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? '';
  const current = results[active] ?? base;
  const busy = generating;

  if (gate === 'checking') {
    return (
      <Shell>
        <Header />
      </Shell>
    );
  }

  if (gate === 'locked') {
    return <LoginScreen onUnlock={unlocked} />;
  }

  const pickers = (
    <>
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onPick} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
    </>
  );

  if (!base) {
    return (
      <Shell>
        {pickers}
        <Header />
        <div className="flex flex-1 flex-col justify-between px-5 pb-8 pt-8">
          <div>
            <Tag>{t('start.tag')}</Tag>
            <h1 className="mt-4 text-[34px] font-bold leading-tight">{t('start.title')}</h1>
            <p className="mt-4 whitespace-pre-line text-[17px] leading-relaxed text-muted">{t('start.intro')}</p>
            <div className="mt-8 grid grid-cols-4 gap-2">
              {categories.flatMap((c) => products.find((p) => p.category === c.id) ?? []).slice(0, 4).map((p) => (
                <figure key={p.id} className="overflow-hidden rounded-wb border border-line">
                  <img src={productThumb(p, 160)} alt="" className="aspect-square w-full object-cover" />
                  <figcaption className="truncate px-1.5 py-1 text-[11px] text-muted">{categoryName(p.category)}</figcaption>
                </figure>
              ))}
            </div>
            <ol className="mt-8 divide-y divide-dotted divide-line border-y border-line">
              {[t('start.step1'), t('start.step2'), t('start.step3')].map((text, i) => (
                <li key={i} className="flex gap-4 py-3.5 text-[15px] text-ink">
                  <span className="w-5 shrink-0 font-bold text-brand">{i + 1}</span>
                  {text}
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-8 space-y-3">
            <PrimaryButton onClick={() => cameraInput.current?.click()}>
              <Camera size={20} /> {t('start.camera')}
            </PrimaryButton>
            <SecondaryButton onClick={() => fileInput.current?.click()}>
              <ImageIcon size={20} /> {t('start.gallery')}
            </SecondaryButton>
            {provider === 'demo' && <p className="pt-1 text-center text-xs text-muted">Demo mode: no AI key configured on the server.</p>}
            <a href="/admin" className="block pt-2 text-center text-xs text-muted underline-offset-2 hover:underline">
              Manage products
            </a>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {pickers}
      <Header
        left={
          <button
            onClick={() => {
              if (busy) return;
              setHistory([]);
              setResults([]);
            }}
            className="-ml-2 p-2 text-brand"
            aria-label="Back"
          >
            <ArrowLeft size={24} />
          </button>
        }
        right={
          <button
            onClick={() => shareImage(current, `new-roof-${product?.id ?? 'result'}`)}
            disabled={busy}
            className="-mr-2 p-2 text-brand disabled:opacity-30"
            aria-label="Share"
          >
            <Share size={22} />
          </button>
        }
      />

      <div className="flex items-baseline justify-between px-5 pb-3 pt-5">
        <p className="shrink-0 text-xs font-bold uppercase tracking-[0.1em] text-muted">{t('editor.heading')}</p>
        {product && (
          <button
            onClick={() => setShowDetails(true)}
            className="min-w-0 truncate pl-4 text-right text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-brand"
            title={t('editor.details')}
          >
            {product.name}
          </button>
        )}
      </div>
      <div className="flex flex-1 items-center">
        <Stage
          base={base}
          results={results}
          active={active}
          onActiveChange={setActive}
          compare={compare}
          generating={generating}
          startedAt={startedAt}
          edgeMaps={edgeMaps}
        />
      </div>

      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex gap-2">
          <ToolButton label="Change photo" onClick={() => fileInput.current?.click()} disabled={busy}>
            <ImageIcon size={20} />
          </ToolButton>
          <ToolButton
            label="Compare before/after"
            onClick={() => setCompare((c) => !c)}
            disabled={busy || results.length === 0}
            active={compare}
          >
            <Columns2 size={20} />
          </ToolButton>
          <ToolButton label="Full screen" onClick={() => setFullscreen(true)} disabled={busy}>
            <Maximize size={20} />
          </ToolButton>
        </div>
        <div className="flex gap-2">
          <ToolButton label="Undo" onClick={() => step(-1)} disabled={busy || (cursor === 0 && results.length === 0)}>
            <Undo2 size={20} />
          </ToolButton>
          <ToolButton label="Redo" onClick={() => step(1)} disabled={busy || cursor >= history.length - 1}>
            <Redo2 size={20} />
          </ToolButton>
        </div>
      </div>

      <section className="border-t border-line bg-paper pb-6 pt-3">
        {product ? (
          <MaterialPicker
            categories={categories}
            products={products}
            selected={product}
            onSelect={(p) => setProductId(p.id)}
            disabled={busy}
          />
        ) : (
          <p className="px-5 py-6 text-center text-sm text-muted">No products yet. Add some at /admin.</p>
        )}
        <div className="mt-5 grid grid-cols-2 gap-3 px-5">
          <SecondaryButton onClick={accept} disabled={busy || results.length === 0}>
            <Check size={20} /> {t('editor.accept')}
          </SecondaryButton>
          <PrimaryButton onClick={generate} disabled={busy || !product}>
            <RefreshCw size={20} className={busy ? 'animate-spin' : ''} /> {t('editor.generate')}
          </PrimaryButton>
        </div>
      </section>

      {toast && (
        <div className="fixed inset-x-4 bottom-28 z-20 mx-auto flex max-w-lg items-start gap-3 rounded-wb border-l-4 border-brand bg-white p-4 text-ink shadow-2xl">
          <Info className="mt-0.5 shrink-0 text-brand" size={20} />
          <p className="flex-1 text-[15px] leading-snug">{toast}</p>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-muted">
            <X size={18} />
          </button>
        </div>
      )}

      {showDetails && product && (
        <ProductDetails product={product} category={categoryName(product.category)} onClose={() => setShowDetails(false)} />
      )}

      {fullscreen && (
        <button className="fixed inset-0 z-30 flex items-center justify-center bg-black" onClick={() => setFullscreen(false)}>
          <img src={current} alt="Full screen" className="max-h-full max-w-full object-contain" />
          <X className="absolute right-4 top-4 text-white" size={28} />
        </button>
      )}
    </Shell>
  );
}

function LoginScreen({ onUnlock }: { onUnlock: (code: string) => void }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    setChecking(true);
    setError('');
    try {
      if (await checkCode(value)) onUnlock(value);
      else setError(t('login.error'));
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <Shell>
      <Header />
      <form onSubmit={submit} className="flex flex-1 flex-col justify-between px-5 pb-8 pt-8">
        <div>
          <Tag>{t('start.tag')}</Tag>
          <h1 className="mt-4 text-[32px] font-bold leading-tight">{t('login.title')}</h1>
          <p className="mt-3 whitespace-pre-line leading-relaxed text-muted">{t('login.intro')}</p>
          <label className="mt-10 block text-sm font-semibold text-ink" htmlFor="code">
            {t('login.label')}
          </label>
          <div className="mt-2 flex items-center gap-3 rounded-wb border border-line bg-white px-3 py-3 focus-within:border-brand">
            <Lock size={18} className="text-muted" />
            <input
              id="code"
              autoFocus
              type="password"
              autoComplete="current-password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-muted"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="mt-3 text-sm font-semibold text-brand">{error}</p>}
        </div>
        <PrimaryButton type="submit" disabled={checking || !code.trim()}>
          {checking ? '…' : t('login.button')} <ArrowRight size={20} />
        </PrimaryButton>
      </form>
    </Shell>
  );
}

function ToolButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-11 w-11 items-center justify-center rounded-wb border transition disabled:opacity-30 ${
        active ? 'border-brand bg-brand text-white' : 'border-line bg-white text-brand hover:border-brand'
      }`}
    >
      {children}
    </button>
  );
}

function ProductDetails({ product, category, onClose }: { product: Product; category: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-[6px] bg-white px-5 pb-8 pt-5 text-ink"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <img src={productThumb(product, 160)} alt="" className="h-20 w-20 shrink-0 rounded-wb border border-line object-cover" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{[product.brand, category].filter(Boolean).join(' · ')}</p>
            <h2 className="text-xl font-bold leading-tight">{product.name}</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-muted">
            <X size={22} />
          </button>
        </div>
        <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-muted">{product.description}</p>
        {product.specs.length > 0 && (
          <>
            <h3 className="mt-6 text-lg font-bold">{t('editor.details')}</h3>
            <dl className="mt-2 divide-y divide-line border-y border-line text-[15px]">
              {product.specs.map((s, i) => (
                <div key={i} className="grid grid-cols-2 gap-4 py-2.5">
                  <dt className="text-muted">{s.label}</dt>
                  <dd>{s.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </div>
  );
}
