import { useEffect, useRef, useState } from 'react';
import { useT } from '../lib/texts';

interface Props {
  base: string;
  results: string[];
  active: number;
  onActiveChange: (i: number) => void;
  compare: boolean;
  generating: boolean;
  startedAt: number | null;
  edgeMaps: string[];
  slideTitles: string[];
  /** Name of the AI model that made the results; written in the bottom right corner of every result. */
  modelLabel?: string;
  /** True while generation waits for the depth map. */
  analysing?: boolean;
  /** Shown under the timer, e.g. when the photo analysis failed. */
  note?: string;
  /** Technical line (which tools made the maps), only passed in debug mode. */
  info?: string;
}

/** Phones: full width at natural height. Desktop: fitted inside the available area. */
const PHOTO = 'block w-full lg:h-full lg:object-contain';

/** The photo area: current image, swipeable results, before/after slider and the generating overlay. */
export function Stage({ base, results, active, onActiveChange, compare, generating, startedAt, edgeMaps, slideTitles, modelLabel, analysing, note, info }: Props) {
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [split, setSplit] = useState(50);

  useEffect(() => {
    scroller.current?.scrollTo({ left: 0 });
  }, [results]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== active) onActiveChange(i);
  };

  const showing = results.length > 0;

  // Width / height of the photo, so the loading overlay covers exactly the photo and not the white sides.
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setRatio(img.naturalWidth / img.naturalHeight);
    img.src = base;
  }, [base]);

  return (
    <div className="relative w-full overflow-hidden bg-paper lg:h-full lg:bg-transparent">
      {showing ? (
        <div ref={scroller} onScroll={onScroll} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto lg:h-full">
          {results.map((src, i) => (
            <div key={i} className="relative w-full shrink-0 snap-center lg:h-full">
              {compare ? (
                <div className="relative lg:h-full">
                  <img src={base} alt="Before" className={PHOTO} />
                  <img
                    src={src}
                    alt="After"
                    className="absolute inset-0 h-full w-full lg:object-contain"
                    style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                  />
                  <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${split}%` }} />
                  <span className="absolute left-0 top-3 bg-ink px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">{t('editor.before')}</span>
                  <span className="absolute right-0 top-3 bg-brand px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-white">{t('editor.after')}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={split}
                    onChange={(e) => setSplit(Number(e.target.value))}
                    className="compare-range absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
                    aria-label="Before/after position"
                  />
                </div>
              ) : (
                <img src={src} alt={`Result ${i + 1}`} className={PHOTO} />
              )}
              {modelLabel && !generating && <ModelBadge ratio={ratio} text={modelLabel} />}
            </div>
          ))}
        </div>
      ) : (
        <img src={base} alt="Your house" className={PHOTO} />
      )}

      {showing && results.length > 1 && !generating && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1">
          {results.map((_, i) => (
            <span key={i} className={`h-1 bg-white transition-all ${i === active ? 'w-8' : 'w-4 opacity-50'}`} />
          ))}
        </div>
      )}

      {generating && <GeneratingOverlay startedAt={startedAt} edgeMaps={edgeMaps} slideTitles={slideTitles} analysing={analysing} note={note} info={info} ratio={ratio} />}
    </div>
  );
}

function GeneratingOverlay({
  startedAt,
  edgeMaps,
  slideTitles,
  analysing,
  note,
  info,
  ratio,
}: {
  startedAt: number | null;
  edgeMaps: string[];
  slideTitles: string[];
  analysing?: boolean;
  note?: string;
  info?: string;
  ratio: number | null;
}) {
  const t = useT();
  // The photo is fitted inside the area (white sides on a wide window); keep the dark layer to the photo itself.
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const el = area.current;
    if (!el || !ratio) return;
    const fit = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const width = cw / ch > ratio ? ch * ratio : cw;
      const height = cw / ch > ratio ? ch : cw / ratio;
      setBox({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  // Show the structure maps once, in order (depth map, roof mask, then line maps if switched on), and stay on
  // the last one until the result arrives. Counting from when the maps arrived starts it at the depth map.
  const [mapsSince, setMapsSince] = useState(0);
  const mapCount = useRef(0);
  const prevMaps = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevMaps.current;
    if (prev.length === 0 || edgeMaps.length === 0) setMapsSince(Date.now());
    else {
      // The list changed (a late slide, or the roof slide replaced by the measured one): stay on the slide being shown, so the show
      // never jumps; slides added before it appear in the next round.
      const elapsed = Date.now() - mapsSince;
      const idx = Math.min(Math.floor(elapsed / 3500), prev.length - 1);
      let j = edgeMaps.indexOf(prev[idx]);
      if (j < 0) j = Math.min(idx, edgeMaps.length - 1);
      setMapsSince(Date.now() - (j * 3500 + (elapsed % 3500)));
    }
    mapCount.current = edgeMaps.length;
    prevMaps.current = edgeMaps;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeMaps]);
  // The show goes through the slides once, in order, and stays on the last one until the result arrives; a slide that arrives late
  // is added behind the others and shown when its turn comes.
  const stage = Math.min(Math.floor((now - mapsSince) / 3500), edgeMaps.length - 1);
  // The main text says what the slide on screen shows; once every slide has had its turn it says the images are being made.
  const slideTitle = edgeMaps.length > 0 && now - mapsSince < edgeMaps.length * 3500 ? slideTitles[stage] : undefined;
  const title = slideTitle ?? t(analysing ? 'editor.analysing' : 'editor.generating');
  const r = 26;
  const circ = 2 * Math.PI * r;
  const progress = (elapsed % 12) / 12;

  return (
    <div ref={area} className="absolute inset-0">
      <div className="absolute inset-0 overflow-hidden" style={box ? { ...box, right: 'auto', bottom: 'auto' } : undefined}>
      {edgeMaps.map((src, i) => (
        <img
          key={i}
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full transition-opacity duration-700 lg:object-contain"
          style={{ opacity: stage === i ? 1 : 0 }}
        />
      ))}
      {analysing && <div className="depth-scan pointer-events-none absolute inset-x-0 h-1/4" />}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/45">
        <div className="relative h-16 w-16">
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
            <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" />
            <circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              stroke="#ffffff"
              strokeWidth="3"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - progress)}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white">{elapsed.toFixed(1)}s</span>
        </div>
        <p className="text-lg font-semibold text-white drop-shadow">{title}</p>
        {note && <p className="max-w-xs px-4 text-center text-sm text-white/90 drop-shadow">{note}</p>}
        {info && <p className="max-w-sm px-4 text-center text-xs text-white/80 drop-shadow">{info}</p>}
      </div>
      </div>
    </div>
  );
}

/** The model name in the bottom right corner of the photo itself (not of the white sides a wide window leaves around it). */
function ModelBadge({ ratio, text }: { ratio: number | null; text: string }) {
  const area = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const el = area.current;
    if (!el || !ratio) return;
    const fit = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (!cw || !ch) return;
      const width = cw / ch > ratio ? ch * ratio : cw;
      const height = cw / ch > ratio ? ch : cw / ratio;
      setBox({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ratio]);
  return (
    <div ref={area} className="pointer-events-none absolute inset-0">
      <div className="absolute" style={box ?? { inset: 0 }}>
        <span className="absolute bottom-2 right-2 max-w-[80%] truncate rounded-[3px] bg-black/55 px-2 py-1 text-[11px] font-semibold text-white sm:text-xs">{text}</span>
      </div>
    </div>
  );
}
