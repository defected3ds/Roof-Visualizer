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
import { MATERIALS } from './materials';
import { buildEdgeMaps, fileToDataUrl, shareImage } from './lib/image';
import { renderSwatch } from './lib/swatch';
import type { GenerateResponse, Material } from './types';

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
  const [gate, setGate] = useState<Gate>('checking');
  const [accessCode, setAccessCode] = useState(storedCode);
  const [history, setHistory] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [material, setMaterial] = useState<Material>(MATERIALS[1]);
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
    if (!base || generating) return;
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
          swatch: renderSwatch(material, 384),
          material: { name: material.name, category: material.category, prompt: material.prompt },
          count: VARIANTS,
        }),
      });
      const data = (await res.json()) as GenerateResponse & { error?: string };
      if (res.status === 401) {
        // The access code was changed on the server: sign in again.
        storeCode('');
        setGate('locked');
        return;
      }
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setResults(data.images);
      setActive(0);
      if (data.provider === 'demo') {
        setToast('Demo mode: add GEMINI_API_KEY or REPLICATE_API_TOKEN on the server to generate real roofs.');
      } else if (data.images.length > 1 && !tipShown.current) {
        tipShown.current = true;
        setToast('Each generation gives several results. Swipe to see the others.');
      }
    } catch (err: any) {
      setToast(err.message || 'Something went wrong');
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
            <Tag>Roof Visualizer</Tag>
            <h1 className="mt-4 text-[34px] font-bold leading-tight">See your house with a new roof</h1>
            <p className="mt-4 text-[17px] leading-relaxed text-muted">
              Take a photo of a house, choose clay tiles, slate, shingles, shake or metal, and see the new roof in seconds,
              while everything else stays as it is.
            </p>
            <div className="mt-8 grid grid-cols-4 gap-2">
              {MATERIALS.filter((_, i) => i % 4 === 1).map((m) => (
                <figure key={m.id} className="overflow-hidden rounded-wb border border-line">
                  <img src={renderSwatch(m, 160)} alt="" className="aspect-square w-full object-cover" />
                  <figcaption className="px-1.5 py-1 text-[11px] text-muted">{m.category}</figcaption>
                </figure>
              ))}
            </div>
            <ol className="mt-8 divide-y divide-dotted divide-line border-y border-line">
              {[
                'Photograph the house from the street, with the roof clearly visible.',
                'Choose a roofing material.',
                'Generate, swipe through the results and accept the one you like.',
              ].map((text, i) => (
                <li key={i} className="flex gap-4 py-3.5 text-[15px] text-ink">
                  <span className="w-5 shrink-0 font-bold text-brand">{i + 1}</span>
                  {text}
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-8 space-y-3">
            <PrimaryButton onClick={() => cameraInput.current?.click()}>
              <Camera size={20} /> Take a photo
            </PrimaryButton>
            <SecondaryButton onClick={() => fileInput.current?.click()}>
              <ImageIcon size={20} /> Choose from gallery
            </SecondaryButton>
            {provider === 'demo' && <p className="pt-1 text-center text-xs text-muted">Demo mode: no AI key configured on the server.</p>}
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
            onClick={() => shareImage(current, `new-roof-${material.id}`)}
            disabled={busy}
            className="-mr-2 p-2 text-brand disabled:opacity-30"
            aria-label="Share"
          >
            <Share size={22} />
          </button>
        }
      />

      <div className="flex items-baseline justify-between px-5 pb-3 pt-5">
        <p className="text-xs font-bold uppercase tracking-[0.1em] text-muted">New roof</p>
        <p className="truncate pl-4 text-sm font-semibold text-ink">{material.name}</p>
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
        <MaterialPicker selected={material} onSelect={setMaterial} disabled={busy} />
        <div className="mt-5 grid grid-cols-2 gap-3 px-5">
          <SecondaryButton onClick={accept} disabled={busy || results.length === 0}>
            <Check size={20} /> Accept
          </SecondaryButton>
          <PrimaryButton onClick={generate} disabled={busy}>
            <RefreshCw size={20} className={busy ? 'animate-spin' : ''} /> Generate
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
      else setError('That access code is not correct.');
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
          <Tag>Roof Visualizer</Tag>
          <h1 className="mt-4 text-[32px] font-bold leading-tight">Sign in to continue</h1>
          <p className="mt-3 leading-relaxed text-muted">Enter the access code you received from wienerberger.</p>
          <label className="mt-10 block text-sm font-semibold text-ink" htmlFor="code">
            Access code
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
          {checking ? 'Checking…' : 'Sign in'} <ArrowRight size={20} />
        </PrimaryButton>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-xl flex-col bg-white text-ink">{children}</main>;
}

function Header({ left, right }: { left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-line bg-white px-5">
      {left}
      <span className="flex items-center gap-1.5" aria-label="wienerberger">
        <img src="/w-symbol.png" alt="" className="h-7 w-7" />
        <img src="/wienerberger-logo.svg" alt="wienerberger" className="h-[17px] w-auto" />
      </span>
      <span className="flex-1" />
      {right}
    </header>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="inline-block rounded-wb bg-brand px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">{children}</span>;
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

function PrimaryButton({ className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex w-full items-center justify-center gap-2 rounded-wb bg-brand py-4 text-[15px] font-bold uppercase tracking-wide text-white transition hover:bg-brand-dark disabled:bg-line disabled:text-muted ${className}`}
    />
  );
}

function SecondaryButton({ className = '', ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={`flex w-full items-center justify-center gap-2 rounded-wb border-2 border-brand bg-white py-[14px] text-[15px] font-bold uppercase tracking-wide text-brand transition hover:bg-brand hover:text-white disabled:border-line disabled:text-muted disabled:hover:bg-white ${className}`}
    />
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
