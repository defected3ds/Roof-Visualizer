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
}

/** Phones: full width at natural height. Desktop: fitted inside the available area. */
const PHOTO = 'block w-full lg:h-full lg:object-contain';

/** The photo area: current image, swipeable results, before/after slider and the generating overlay. */
export function Stage({ base, results, active, onActiveChange, compare, generating, startedAt, edgeMaps, analysing, note }: Props) {
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

      {generating && <GeneratingOverlay startedAt={startedAt} edgeMaps={edgeMaps} analysing={analysing} note={note} />}
    </div>
  );
}

function GeneratingOverlay({ startedAt, edgeMaps, analysing, note }: { startedAt: number | null; edgeMaps: string[]; analysing?: boolean; note?: string }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  // Show the structure maps once, in order (depth map, roof mask, then line maps if switched on), and stay on
  // the last one until the result arrives. Counting from when the maps arrived starts it at the depth map.
  const [mapsSince, setMapsSince] = useState(0);
  useEffect(() => setMapsSince(Date.now()), [edgeMaps]);
  const stage = Math.min(Math.floor((now - mapsSince) / 3500), edgeMaps.length - 1);
  const r = 26;
  const circ = 2 * Math.PI * r;
  const progress = (elapsed % 12) / 12;

  return (
    <div className="absolute inset-0">
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
      </div>
    </div>
  );
}
