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
export function Stage({ base, results, active, onActiveChange, compare, generating, startedAt, edgeMaps, analysing, note, info }: Props) {
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

      {generating && <GeneratingOverlay startedAt={startedAt} edgeMaps={edgeMaps} analysing={analysing} note={note} info={info} ratio={ratio} />}
    </div>
  );
}

function GeneratingOverlay({
  startedAt,
  edgeMaps,
  analysing,
  note,
  info,
  ratio,
}: {
  startedAt: number | null;
  edgeMaps: string[];
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
  useEffect(() => {
    // A slide added later (the measurement) joins the show; it doesn't restart it.
    if (mapCount.current === 0 || edgeMaps.length < mapCount.current) setMapsSince(Date.now());
    mapCount.current = edgeMaps.length;
  }, [edgeMaps]);
  const stage = Math.min(Math.floor((now - mapsSince) / 3500), edgeMaps.length - 1);
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
        <p className="text-lg font-semibold text-white drop-shadow">{t(analysing ? 'editor.analysing' : 'editor.generating')}</p>
        {note && <p className="max-w-xs px-4 text-center text-sm text-white/90 drop-shadow">{note}</p>}
        {info && <p className="max-w-sm px-4 text-center text-xs text-white/80 drop-shadow">{info}</p>}
      </div>
      </div>
    </div>
  );
}
