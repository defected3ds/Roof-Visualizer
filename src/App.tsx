import { useEffect, useMemo, useRef, useState } from 'react';
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
  Upload,
  X,
} from 'lucide-react';
import { MaterialPicker } from './components/MaterialPicker';
import { History, type HistoryItem } from './components/History';
import { Stage } from './components/Stage';
import { Header, PrimaryButton, SecondaryButton, Shell, Tag } from './components/ui';
import { configureDepth, depthFor, depthWithin, snapToMask } from './lib/depth';
import { configureRoofMask, roofMaskFor, roofMaskWithin, wallMaskFor, type RoofMask } from './lib/roofmask';
import { buildMeasureCard, captionSlide, roofOverWalls, ROOF_LABEL, WALL_LABEL, type MeasureOutcome } from './lib/measureCard';
import { buildEdgeMaps, fileToDataUrl, shareImage, thumbnail } from './lib/image';
import { productThumb, renderSwatch } from './lib/swatch';
import { TextsProvider, useT, useTextsReady } from './lib/texts';
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

/** A short random id (letters and digits). */
function newId() {
  return (crypto.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 36);
}

/** Sends small previews of the photo and the results to the cost history. Never disturbs the visitor. */
async function sendPreviews(generationId: string, house: string, results: string[], accessCode: string) {
  try {
    const [h, ...r] = await Promise.all([thumbnail(house), ...results.slice(0, 4).map((x) => thumbnail(x))]);
    await fetch('/api/usage/previews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': accessCode },
      body: JSON.stringify({ generationId, house: h, results: r }),
    });
  } catch {
    // The history is a nice-to-have.
  }
}

/** With a sharp roof mask (SAM 3) the roof edge of the browser depth map is made crisp; a rough mask would only make it worse. */
function sharpDepth(depth: Awaited<ReturnType<typeof depthFor>>, mask: Awaited<ReturnType<typeof roofMaskFor>>) {
  // Only the coarse browser depth map needs this; the fal.ai maps already have clean edges.
  return depth && depth.source === 'browser' && mask && mask.source === 'sam3' ? snapToMask(depth, mask.mask) : Promise.resolve(depth);
}

/** How many earlier generations are kept for the history strip (each holds full-size images in memory). */
const HISTORY_LIMIT = 10;

/** Phones, tablets and anything with a touch screen can take a photo; a computer with a mouse just uploads one. */
function useCanTakePhoto() {
  const query = '(pointer: coarse), (max-width: 1023px)';
  const [value, setValue] = useState(() => (typeof window !== 'undefined' ? window.matchMedia(query).matches : true));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setValue(mq.matches);
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return value;
}

function RoofApp() {
  const t = useT();
  const textsReady = useTextsReady();
  const [gate, setGate] = useState<Gate>('checking');
  const [accessCode, setAccessCode] = useState(storedCode);
  const [history, setHistory] = useState<string[]>([]);
  // Random id of the picked photo: groups its API calls in the cost history (Admin > Costs).
  const photoId = useRef('');
  // Roof measurement (admin option): started with the photo analysis, awaited at Generate so the numbers are ready for the prompt.
  const measureTool = useRef('off');
  const measuring = useRef<{ photo: string; id: string; done: Promise<MeasureOutcome | null> } | null>(null);
  const measureShow = useRef(true);
  const measureWait = useRef(60);
  const generationRun = useRef(0);
  const [cursor, setCursor] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  // Earlier generations of this photo (newest first) and the one currently on the stage.
  const [gallery, setGallery] = useState<(HistoryItem & { base: string })[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  // Slides of the loading screen: head (depth maps, Depth Pro depth, walls, roof; the late ones are inserted when they arrive) and tail (edge maps).
  const [slideBase, setSlideBase] = useState<{ head: string[]; tail: string[] }>({ head: [], tail: [] });
  const edgeMaps = useMemo(() => [...slideBase.head, ...slideBase.tail], [slideBase]);
  // Photo analysis (depth map, roof mask) for the current photo; which ones run is set in /admin > AI settings.
  const [analysis, setAnalysis] = useState({ depth: true, mask: true });
  const [showEdgeMaps, setShowEdgeMaps] = useState(true);
  // True when the depth map and roof mask were wanted but could not be made on this device.
  const [noAnalysis, setNoAnalysis] = useState(false);
  // Which tools made the depth map and roof mask (shown on the loading screen when the address ends in ?debug).
  const [analysisInfo, setAnalysisInfo] = useState('');
  const [analysing, setAnalysing] = useState<string | null>(null);
  const [waitingForAnalysis, setWaitingForAnalysis] = useState(false);
  const [compare, setCompare] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const tipShown = useRef(false);

  const base = history[cursor];
  const canTakePhoto = useCanTakePhoto();

  /** Reads the current settings from the server (also before every generation, so admin changes apply at once). */
  async function loadSettings() {
    const health = await (await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(5000) })).json();
    setProvider(health.provider);
    if (health.analysis) setAnalysis(health.analysis);
    configureRoofMask({ tool: health.maskTool === 'sam3' ? 'sam3' : 'clipseg' });
    configureDepth({ tool: health.depthTool === 'marigold' || health.depthTool === 'midas' ? health.depthTool : 'browser' });
    measureTool.current = health.measureTool === 'depthpro' ? 'depthpro' : 'off';
    measureShow.current = health.measureShow !== false;
    measureWait.current = Number(health.measureWait) > 0 ? Number(health.measureWait) : 60;
    if (typeof health.edgeMaps === 'boolean') setShowEdgeMaps(health.edgeMaps);
    return health as { locked: boolean; edgeMaps?: boolean; analysis?: typeof analysis; depthTool?: string };
  }

  useEffect(() => {
    (async () => {
      try {
        const health = await loadSettings();
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
    configureRoofMask({ accessCode });
    configureDepth({ accessCode });
  }, [accessCode]);

  // Analyse the photo (depth map, then roof mask) as soon as there is one, while the customer picks a product.
  const analyseWith = async (photo: string, flags: { depth: boolean; mask: boolean }) => {
    const [d, m] = await Promise.all([flags.depth ? depthFor(photo) : null, flags.mask ? roofMaskFor(photo) : null]);
    return [await sharpDepth(d, m), m] as const;
  };
  const startMeasure = (photo: string): Promise<MeasureOutcome | null> => {
    if (measureTool.current !== 'depthpro') return Promise.resolve(null);
    if (measuring.current?.photo === photo && measuring.current.id === photoId.current) return measuring.current.done;
    const done = fetch('/api/measure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Access-Code': accessCode },
      body: JSON.stringify({ image: photo, photoId: photoId.current }),
    })
      .then(async (r) => ((await r.json()) as MeasureOutcome) ?? null)
      .catch(() => null);
    measuring.current = { photo, id: photoId.current, done };
    return done;
  };
  // Nothing is analysed when a photo is picked: depth map, roof mask, walls and measurement all start when Generate is pressed
  // (visitors who only look at the photo cost nothing).
  useEffect(() => setAnalysing(null), [base]);

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
      // Pick up the current admin settings first, so a page left open for hours doesn't make maps that are switched off.
      await loadSettings().catch(() => null);
      photoId.current = newId();
      configureDepth({ photoId: photoId.current });
      configureRoofMask({ photoId: photoId.current });
      setHistory([url]);
      setCursor(0);
      setResults([]);
      setGallery([]);
      setViewing(null);
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
    // Previews for the loading animation: depth maps, the detected roof, then edge maps (if switched on in
    // /admin > AI settings). Until the analysis is done the overlay says "Analysing 3D shape".
    setSlideBase({ head: [], tail: [] });
    const runId = ++generationRun.current;
    const live = await loadSettings().catch(() => null);
    setAnalysing(base);
    // Everything starts now, in parallel: depth map, roof mask (below), and for the measurement setup the walls and the measurement.
    if (measureTool.current === 'depthpro' && measureShow.current) void wallMaskFor(base);
    void startMeasure(base);
    const edges = (live?.edgeMaps ?? showEdgeMaps) ? buildEdgeMaps(base).catch(() => [] as string[]) : Promise.resolve([] as string[]);
    setNoAnalysis(false);
    // What the admin has switched on right now (not what this page loaded with): only those maps are made and shown.
    const use = live?.analysis ?? analysis;
    // The loading-screen slides appear one by one, each as soon as its data exists (depth maps, then walls, roof, Depth Pro's depth and the
    // measurement), instead of all at once when the slowest service has answered.
    const measuring = measureTool.current === 'depthpro' && measureShow.current;
    const parts: {
      d: Awaited<ReturnType<typeof depthFor>>;
      m: RoofMask | null;
      wall: RoofMask | null;
      summary: MeasureOutcome['summary'] | null;
      depthPro: string | null;
      tail: string[];
    } = { d: null, m: null, wall: null, summary: null, depthPro: null, tail: [] };
    // Rebuilds run one after the other, so a slow one can't overwrite a newer picture.
    let queue: Promise<void> = Promise.resolve();
    const rebuild = () =>
      (queue = queue.then(async () => {
        if (runId !== generationRun.current) return;
        const { d, m, wall } = parts;
        const flat = measuring && wall && m ? await roofOverWalls(wall.overlay, m.mask).catch(() => m.overlay) : m?.overlay;
        const card = flat && m && measuring && parts.summary ? await buildMeasureCard(flat, m.mask, parts.summary).catch(() => flat) : flat;
        const roofSlide = card ? await captionSlide(card, measuring && wall ? [WALL_LABEL, ROOF_LABEL] : [ROOF_LABEL]).catch(() => card) : null;
        const wallSlide = wall ? await captionSlide(wall.overlay, [WALL_LABEL]).catch(() => wall.overlay) : null;
        const depthProSlide = parts.depthPro ? await captionSlide(parts.depthPro, 'Distance from the camera: red = near, blue = far').catch(() => parts.depthPro!) : null;
        if (runId !== generationRun.current) return;
        // Order: depth maps, Depth Pro's depth (3rd), walls, roof.
        setSlideBase({ head: [...(d ? [d.gray, d.color] : []), ...(depthProSlide ? [depthProSlide] : []), ...(wallSlide ? [wallSlide] : []), ...(roofSlide ? [roofSlide] : [])], tail: parts.tail });
      }));
    const depthP = use.depth ? depthFor(base) : Promise.resolve(null);
    const maskP = use.mask ? roofMaskFor(base) : Promise.resolve(null);
    void (async () => {
      const raw = await depthP.catch(() => null);
      parts.d = raw;
      void rebuild();
      const m = await maskP.catch(() => null);
      parts.m = m;
      parts.d = await sharpDepth(raw, m).catch(() => raw);
      const d = parts.d;
      setNoAnalysis((use.depth || use.mask) && !d && !m);
      const depthName = d ? (d.source === 'marigold' ? 'Marigold (fal.ai)' : d.source === 'midas' ? 'MiDaS (fal.ai)' : `browser model${d.fallback ? ` (server depth map failed: ${d.fallback})` : ''}`) : 'none';
      setAnalysisInfo(`Depth map: ${depthName} · Roof mask: ${m ? (m.source === 'sam3' ? 'SAM 3 (fal.ai)' : 'CLIPSeg (browser)') : 'none'}`);
      parts.tail = await edges;
      void rebuild();
    })();
    if (measuring) {
      void wallMaskFor(base).then((w) => {
        parts.wall = w;
        void rebuild();
      });
      void Promise.race([startMeasure(base), new Promise<null>((r) => setTimeout(r, 120000))]).then((measured) => {
        if (runId !== generationRun.current || !(measured?.depthColor || measured?.summary)) return;
        parts.depthPro = measured.depthColor ?? null;
        parts.summary = measured.summary ?? null;
        void rebuild();
      });
    }
    // Depth map and roof mask help the AI understand the roof; don't wait long for slow phones.
    setWaitingForAnalysis(true);
    const [depthRaw, roofMask] = await Promise.all([
      use.depth ? depthWithin(base, live?.depthTool === 'marigold' || live?.depthTool === 'midas' ? 60000 : 20000) : null,
      use.mask ? roofMaskWithin(base, 20000) : null,
      // The measurement goes into the prompt, so wait for it (admin setting, 60 s by default), then generate without it.
      Promise.race([startMeasure(base), new Promise<null>((r) => setTimeout(r, measureWait.current * 1000))]),
    ]).then(([d, m]) => [d, m] as const);
    const depthMaps = await sharpDepth(depthRaw, roofMask);
    setWaitingForAnalysis(false);
    setAnalysing((cur) => (cur === base ? null : cur));
    const generationId = newId();
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Access-Code': accessCode },
        body: JSON.stringify({
          image: base,
          productId: product.id,
          swatch: product.images.length ? undefined : renderSwatch(product, 384),
          depth: depthMaps?.gray,
          mask: roofMask?.mask,
          count: VARIANTS,
          photoId: photoId.current,
          generationId,
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
      if (data.code === 'unavailable') throw new Error(t('message.unavailable'));
      if (data.code === 'busy') throw new Error(t('message.busy'));
      if (!res.ok) {
        console.error('Generation failed:', data.error);
        // Add the provider's reason (shortened), so a wrong model name or setting can be spotted at once.
        const reason = String(data.error ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);
        throw new Error(reason ? `${t('message.error')} (${reason})` : t('message.error'));
      }
      setResults(data.images);
      setActive(0);
      void sendPreviews(generationId, base, data.images, accessCode);
      const id = Date.now();
      setGallery((g) => [{ id, base, product: [product.brand, product.name].filter(Boolean).join(' '), images: data.images }, ...g].slice(0, HISTORY_LIMIT));
      setViewing(id);
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
    setViewing(null);
    setCompare(false);
  }

  /** Shows the results of an earlier generation again, on the photo they were made from. */
  function openGeneration(id: number) {
    const item = gallery.find((g) => g.id === id);
    if (!item || generating) return;
    const at = history.indexOf(item.base);
    if (at >= 0) setCursor(at);
    setResults(item.images);
    setActive(0);
    setViewing(id);
    setCompare(false);
  }

  function step(delta: number) {
    setResults([]);
    setViewing(null);
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
      <Shell app>
        {pickers}
        <Header />
        {/* Desktop: photo on the left, text and buttons on the right. */}
        <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Wait for the admin's photo setting so the old default doesn't flash first. */}
        <div className="aspect-[4/3] w-full bg-paper lg:sticky lg:top-16 lg:aspect-auto lg:h-[calc(100dvh-4rem)]">
          {textsReady && <img src={t('start.image')} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="flex flex-1 flex-col justify-between px-5 pb-8 pt-6 lg:mx-auto lg:w-full lg:max-w-xl lg:justify-center lg:gap-4 lg:px-12 lg:py-12">
          <div>
            <Tag>{t('start.tag')}</Tag>
            <h1 className="mt-4 text-[34px] font-bold leading-tight lg:text-[44px]">{t('start.title')}</h1>
            <p className="mt-4 whitespace-pre-line text-[17px] leading-relaxed text-muted">{t('start.intro')}</p>
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
            {canTakePhoto ? (
              <>
                <PrimaryButton onClick={() => cameraInput.current?.click()}>
                  <Camera size={20} /> {t('start.camera')}
                </PrimaryButton>
                <SecondaryButton onClick={() => fileInput.current?.click()}>
                  <ImageIcon size={20} /> {t('start.gallery')}
                </SecondaryButton>
              </>
            ) : (
              // A computer has no camera to speak of: just upload a photo.
              <PrimaryButton onClick={() => fileInput.current?.click()}>
                <Upload size={20} /> {t('start.upload')}
              </PrimaryButton>
            )}
            {t('start.privacy') && <p className="pt-1 text-center text-xs leading-snug text-muted">{t('start.privacy')}</p>}
            {provider === 'demo' && <p className="pt-1 text-center text-xs text-muted">Demo mode: no AI key configured on the server.</p>}
          </div>
        </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell app>
      {pickers}
      <Header
        left={
          <button
            onClick={() => {
              if (busy) return;
              setHistory([]);
              setResults([]);
              setGallery([]);
              setViewing(null);
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

      {/* Desktop: photo area on the left, product panel on the right, both fitting the window height. */}
      <div className="flex flex-1 flex-col lg:grid lg:h-[calc(100dvh-4rem)] lg:flex-none lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
      <div className="flex flex-1 flex-col lg:min-h-0">
      <div className="flex items-baseline justify-between px-5 pb-3 pt-5 lg:px-8">
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
      <div className="flex flex-1 items-center lg:min-h-0 lg:px-8">
        <Stage
          base={base}
          results={results}
          active={active}
          onActiveChange={setActive}
          compare={compare}
          generating={generating}
          startedAt={startedAt}
          edgeMaps={edgeMaps}
          analysing={generating && waitingForAnalysis && analysing === base}
          note={noAnalysis ? t('editor.noAnalysis') : undefined}
          info={new URLSearchParams(window.location.search).has('debug') ? analysisInfo : undefined}
        />
      </div>

      <div className="flex items-center justify-between px-5 py-4 lg:px-8">
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

      <History items={gallery} viewing={viewing} onOpen={openGeneration} disabled={busy} />

      </div>

      <section className="border-t border-line bg-paper pb-6 pt-3 lg:flex lg:min-h-0 lg:flex-col lg:border-l lg:border-t-0 lg:pt-4">
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
        <div className="mt-5 grid shrink-0 grid-cols-2 gap-3 px-5 lg:mt-0 lg:border-t lg:border-line lg:pt-5">
          <SecondaryButton onClick={accept} disabled={busy || results.length === 0}>
            <Check size={20} /> {t('editor.accept')}
          </SecondaryButton>
          <PrimaryButton onClick={generate} disabled={busy || !product}>
            <RefreshCw size={20} className={busy ? 'animate-spin' : ''} /> {t('editor.generate')}
          </PrimaryButton>
        </div>
      </section>
      </div>

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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40 lg:items-center" onClick={onClose}>
      <div
        className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-[6px] bg-white px-5 pb-8 pt-5 text-ink lg:rounded-[6px] lg:px-8"
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
