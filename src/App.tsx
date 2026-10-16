import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Camera,
  Check,
  Columns2,
  Image as ImageIcon,
  Info,
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

export default function App() {
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
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setProvider(d.provider))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: base,
          swatch: renderSwatch(material, 384),
          material: { name: material.name, category: material.category, prompt: material.prompt },
          count: VARIANTS,
        }),
      });
      const data = (await res.json()) as GenerateResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
      setResults(data.images);
      setActive(0);
      if (data.provider === 'demo') {
        setToast('Demo mode: add GEMINI_API_KEY or REPLICATE_API_TOKEN to .env to generate real roofs.');
      } else if (data.images.length > 1 && !tipShown.current) {
        tipShown.current = true;
        setToast('Tip: Each generation produces several images. Swipe to see the other results.');
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

  const pickers = (
    <>
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onPick} />
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} />
    </>
  );

  if (!base) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-between bg-neutral-950 px-6 pb-10 pt-16 text-white">
        {pickers}
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-300">Roof Visualizer</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight">See your house with a new roof.</h1>
          <p className="mt-4 text-white/70">
            Take or upload a photo of a house, choose tile, slate, shingles, shake or metal, and AI will re-roof it while keeping
            everything else the same.
          </p>
          <div className="mt-10 grid grid-cols-4 gap-2">
            {MATERIALS.filter((_, i) => i % 4 === 1).map((m) => (
              <img key={m.id} src={renderSwatch(m, 160)} alt={m.name} className="aspect-square rounded-xl object-cover" />
            ))}
          </div>
          <ol className="mt-10 space-y-3 text-white/80">
            <li>1. Photograph the house from the street, roof clearly visible.</li>
            <li>2. Pick a roofing material.</li>
            <li>3. Generate, swipe through the results, and accept the one you like.</li>
          </ol>
        </div>
        <div className="mt-10 space-y-3">
          <button
            onClick={() => cameraInput.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-200 py-4 text-lg font-semibold text-slate-900"
          >
            <Camera size={22} /> Take a photo
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-white/10 py-4 text-lg font-semibold"
          >
            <ImageIcon size={22} /> Choose from gallery
          </button>
          {provider === 'demo' && (
            <p className="text-center text-xs text-amber-300/90">Demo mode — no AI key configured on the server.</p>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col bg-neutral-950 text-white">
      {pickers}
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <button
          onClick={() => {
            if (busy) return;
            setHistory([]);
            setResults([]);
          }}
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft size={26} />
        </button>
        <button
          onClick={() => shareImage(current, `new-roof-${material.id}`)}
          disabled={busy}
          className="rounded-2xl bg-slate-500/60 px-6 py-3 transition hover:bg-slate-500/80 disabled:opacity-40"
          aria-label="Share"
        >
          <Share size={22} />
        </button>
      </header>

      <p className="pb-2 pt-4 text-center text-sm font-medium">New Roof</p>
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

      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex gap-3">
          <ToolButton label="Change photo" onClick={() => fileInput.current?.click()} disabled={busy}>
            <ImageIcon size={22} />
          </ToolButton>
          <ToolButton
            label="Compare before/after"
            onClick={() => setCompare((c) => !c)}
            disabled={busy || results.length === 0}
            active={compare}
          >
            <Columns2 size={22} />
          </ToolButton>
          <ToolButton label="Full screen" onClick={() => setFullscreen(true)} disabled={busy}>
            <Maximize size={22} />
          </ToolButton>
        </div>
        <div className="flex overflow-hidden rounded-full bg-white/10">
          <button
            onClick={() => step(-1)}
            disabled={busy || (cursor === 0 && results.length === 0)}
            className="px-4 py-3 disabled:opacity-30"
            aria-label="Undo"
          >
            <Undo2 size={22} />
          </button>
          <span className="w-px bg-white/20" />
          <button onClick={() => step(1)} disabled={busy || cursor >= history.length - 1} className="px-4 py-3 disabled:opacity-30" aria-label="Redo">
            <Redo2 size={22} />
          </button>
        </div>
      </div>

      <section className="rounded-t-3xl bg-neutral-900 pb-6 pt-5">
        <MaterialPicker selected={material} onSelect={setMaterial} disabled={busy} />
        <div className="mt-5 grid grid-cols-2 gap-3 px-4">
          <button
            onClick={accept}
            disabled={busy || results.length === 0}
            className="flex items-center justify-center gap-2 rounded-2xl bg-sky-200 py-4 text-lg font-semibold text-slate-900 transition disabled:bg-slate-600/50 disabled:text-slate-400"
          >
            <Check size={22} /> Accept
          </button>
          <button
            onClick={generate}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-2xl bg-neutral-100 py-4 text-lg font-semibold text-slate-900 transition disabled:bg-neutral-600/60 disabled:text-neutral-400"
          >
            <RefreshCw size={22} className={busy ? 'animate-spin' : ''} /> Generate
          </button>
        </div>
      </section>

      {toast && (
        <div className="fixed inset-x-4 bottom-28 z-20 mx-auto flex max-w-lg items-center gap-4 rounded-2xl bg-neutral-700/95 p-4 shadow-xl">
          <Info className="shrink-0 text-white/80" size={28} />
          <p className="flex-1 text-[15px] font-medium leading-snug">{toast}</p>
          <button onClick={() => setToast(null)} aria-label="Dismiss" className="text-white/60">
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
    </main>
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
      className={`flex h-12 w-12 items-center justify-center rounded-full transition disabled:opacity-30 ${
        active ? 'bg-sky-200 text-slate-900' : 'bg-white/10 hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  );
}
