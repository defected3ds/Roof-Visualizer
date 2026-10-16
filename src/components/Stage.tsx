import { useEffect, useRef, useState } from 'react';

interface Props {
  base: string;
  results: string[];
  active: number;
  onActiveChange: (i: number) => void;
  compare: boolean;
  generating: boolean;
  startedAt: number | null;
  edgeMaps: string[];
}

/** The photo area: current image, swipeable results, before/after slider and the generating overlay. */
export function Stage({ base, results, active, onActiveChange, compare, generating, startedAt, edgeMaps }: Props) {
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
    <div className="relative w-full overflow-hidden bg-black">
      {showing ? (
        <div ref={scroller} onScroll={onScroll} className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto">
          {results.map((src, i) => (
            <div key={i} className="relative w-full shrink-0 snap-center">
              {compare ? (
                <div className="relative">
                  <img src={base} alt="Before" className="block w-full" />
                  <img
                    src={src}
                    alt="After"
                    className="absolute inset-0 h-full w-full"
                    style={{ clipPath: `inset(0 0 0 ${split}%)` }}
                  />
                  <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${split}%` }} />
                  <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">Before</span>
                  <span className="absolute right-2 top-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">After</span>
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
                <img src={src} alt={`Result ${i + 1}`} className="block w-full" />
              )}
            </div>
          ))}
        </div>
      ) : (
        <img src={base} alt="Your house" className="block w-full" />
      )}

      {showing && results.length > 1 && !generating && (
        <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
          {results.map((_, i) => (
            <span key={i} className={`h-2 rounded-full bg-white transition-all ${i === active ? 'w-6 bg-sky-200' : 'w-2 opacity-80'}`} />
          ))}
        </div>
      )}

      {generating && <GeneratingOverlay startedAt={startedAt} edgeMaps={edgeMaps} />}
    </div>
  );
}

function GeneratingOverlay({ startedAt, edgeMaps }: { startedAt: number | null; edgeMaps: string[] }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);
  const elapsed = startedAt ? (now - startedAt) / 1000 : 0;
  // Cycle through the structure maps, then fade back to the photo, like "analysing" the house.
  const stage = Math.floor(elapsed / 3.5) % (edgeMaps.length + 1);
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
          className="absolute inset-0 h-full w-full transition-opacity duration-700"
          style={{ opacity: stage === i ? 1 : 0 }}
        />
      ))}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40">
        <div className="relative h-16 w-16">
          <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
            <circle cx="32" cy="32" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="5" />
            <circle
              cx="32"
              cy="32"
              r={r}
              fill="none"
              stroke="#2196f3"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={circ * (1 - progress)}
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white">{elapsed.toFixed(1)}s</span>
        </div>
        <p className="text-lg tracking-wide text-white drop-shadow">Generating Images</p>
      </div>
    </div>
  );
}
