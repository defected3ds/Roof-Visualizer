import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import type { UsageEvent, UsageSettings, UsageView, VisitorInfo } from '../types';
import { api, fieldClass, type SaveResult } from './Admin';

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const money = (v: number) => `$${v.toFixed(v === 0 ? 2 : v < 0.1 ? 4 : 3)}`;
const GENERATION = new Set(['image', 'test-image']);
const KIND_LABEL: Record<string, string> = {
  image: 'Image',
  'test-image': 'Image (test)',
  depth: 'Depth map',
  'test-depth': 'Depth map (test)',
  'roof-mask': 'Roof mask',
  'test-roof-mask': 'Roof mask (test)',
  measure: 'Roof measurement',
  'test-measure': 'Roof measurement (test)',
};

interface Row {
  key: string;
  head: UsageEvent;
  calls: UsageEvent[];
  total: number;
}

const visitorOf = (e: UsageEvent) => (e.detail?.visitor ?? null) as VisitorInfo | null;

function place(v: VisitorInfo | null) {
  return [v?.city, v?.country].filter(Boolean).join(', ');
}

function minutes(sec?: number) {
  if (sec === undefined) return '';
  return sec < 90 ? `${sec} s` : `${Math.round(sec / 60)} min`;
}

interface Visit {
  generations: number;
  cost: number;
  seconds: number;
  /** Same IP and device = same person, even in a later visit. */
  person: string;
  personNo: number;
  visitNo: number;
  first: string;
}

interface Group {
  key: string;
  session?: string;
  rows: Row[];
}

/** Rows of the same visit together (newest visit first); rows from before visitor tracking go last. */
function groupByVisit(rows: Row[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const session = visitorOf(row.head)?.session;
    const key = session ?? 'none';
    if (!groups.has(key)) groups.set(key, { key, session, rows: [] });
    groups.get(key)!.rows.push(row);
  }
  const all = [...groups.values()];
  return [...all.filter((g) => g.session), ...all.filter((g) => !g.session)];
}

function VisitHeader({ group, visits }: { group: Group; visits: Map<string, Visit> }) {
  const visit = group.session ? visits.get(group.session) : undefined;
  const v = visitorOf(group.rows[0].head);
  if (!visit || !v) {
    return <p className="rounded-wb bg-paper px-3 py-1.5 text-xs font-semibold text-muted">Earlier calls (before visitor details were recorded)</p>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-wb border border-line bg-paper px-3 py-2 text-xs">
      <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Visitor {visit.personNo}</span>
      <span className="font-semibold">Visit {visit.visitNo}</span>
      <span className="text-muted">
        {[place(v), v.device, v.ip && `IP ${v.ip}`].filter(Boolean).join(' · ')} · started {when(visit.first)} · {visit.generations} generation
        {visit.generations === 1 ? '' : 's'} · {money(visit.cost)}
      </span>
    </div>
  );
}

/** What each visit (session) did in the loaded period. */
function visitStats(events: UsageEvent[]): Map<string, Visit> {
  const m = new Map<string, Visit>();
  const persons = new Map<string, number>();
  const visitsOf = new Map<string, number>();
  // Oldest first, so visitors and visits are numbered in the order they arrived.
  for (const e of [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const v = visitorOf(e);
    if (!v?.session) continue;
    let s = m.get(v.session);
    if (!s) {
      const person = `${v.ip ?? ''}|${v.device ?? ''}`;
      if (!persons.has(person)) persons.set(person, persons.size + 1);
      visitsOf.set(person, (visitsOf.get(person) ?? 0) + 1);
      s = { generations: 0, cost: 0, seconds: 0, person, personNo: persons.get(person)!, visitNo: visitsOf.get(person)!, first: e.created_at };
    }
    if (GENERATION.has(e.kind) && !e.kind.startsWith('test-')) s.generations += 1;
    s.cost += e.cost;
    s.seconds = Math.max(s.seconds, v.sessionSeconds ?? 0);
    m.set(v.session, s);
  }
  return m;
}

function when(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

/** One row per generation, with the depth map and roof mask made for its photo; analysis-only photos get their own row. */
function buildRows(events: UsageEvent[]): Row[] {
  const gens = events.filter((e) => GENERATION.has(e.kind));
  const rows = new Map<string, Row>();
  for (const g of gens) rows.set(`g${g.id}`, { key: `g${g.id}`, head: g, calls: [g], total: g.cost });
  // Analysis calls belong to the first generation made from the same photo after them.
  const byPhoto = new Map<string, UsageEvent[]>();
  for (const g of [...gens].reverse()) if (g.photo_id) byPhoto.set(g.photo_id, [...(byPhoto.get(g.photo_id) ?? []), g]);
  for (const e of events) {
    if (GENERATION.has(e.kind)) continue;
    const target = e.photo_id ? byPhoto.get(e.photo_id)?.find((g) => g.created_at >= e.created_at) : undefined;
    // A roof measurement that finished after the generation still belongs to the first generation of its photo.
    const late = !target && e.kind === 'measure' && e.photo_id ? byPhoto.get(e.photo_id)?.[0] : undefined;
    const row = target || late ? rows.get(`g${(target ?? late)!.id}`) : undefined;
    if (row) {
      row.calls.push(e);
      row.total += e.cost;
    } else {
      rows.set(`a${e.id}`, { key: `a${e.id}`, head: e, calls: [e], total: e.cost });
    }
  }
  return [...rows.values()].sort((a, b) => b.head.created_at.localeCompare(a.head.created_at));
}

export function CostsTab({ password, onSaved }: { password: string; onSaved: (r: SaveResult) => void }) {
  const [days, setDays] = useState(30);
  const [view, setView] = useState<UsageView | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(40);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setView(await api<UsageView>(password, 'GET', `/api/admin/usage?days=${days}`));
      setAsked(new Set());
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [password, days]);
  useEffect(() => {
    void load();
  }, [load]);

  // Preview pictures come separately (they are big): for the generations that are listed, in batches of 20.
  const [pictures, setPictures] = useState<Record<string, UsageEvent['previews']>>({});
  const baseEvents = view?.events ?? [];
  const events = useMemo(() => baseEvents.map((e) => (pictures[String(e.id)] ? { ...e, previews: pictures[String(e.id)] } : e)), [baseEvents, pictures]);
  const rows = useMemo(() => buildRows(events), [events]);
  const visits = useMemo(() => visitStats(events), [events]);
  const measures = useMemo(() => {
    const m = new Map<string, UsageEvent>();
    for (const e of [...events].reverse()) if (e.kind === 'measure' && e.photo_id) m.set(e.photo_id, e);
    return m;
  }, [events]);
  const groups = useMemo(() => groupByVisit(rows.slice(0, shown)), [rows, shown]);
  const shownIds = useMemo(
    () => rows.slice(0, shown).flatMap((r) => r.calls.filter((c) => GENERATION.has(c.kind)).map((c) => String(c.id))),
    [rows, shown],
  );
  const [asked, setAsked] = useState<Set<string>>(new Set());
  useEffect(() => {
    const need = shownIds.filter((id) => !asked.has(id)).slice(0, 20);
    if (!need.length) return;
    setAsked((cur) => new Set([...cur, ...need]));
    api<{ previews: Record<string, UsageEvent['previews']> }>(password, 'GET', `/api/admin/usage/previews?ids=${need.join(',')}`)
      .then((r) => setPictures((cur) => ({ ...cur, ...r.previews })))
      .catch(() => undefined);
  }, [shownIds, asked, password]);
  const summary = useMemo(() => {
    const real = events.filter((e) => !e.kind.startsWith('test-'));
    const total = real.reduce((s, e) => s + e.cost, 0);
    const tests = events.filter((e) => e.kind.startsWith('test-')).reduce((s, e) => s + e.cost, 0);
    const gens = real.filter((e) => e.kind === 'image' && (e.results ?? 0) > 0);
    const failed = real.filter((e) => e.kind === 'image' && !(e.results ?? 0)).length;
    const images = real.filter((e) => e.kind === 'image').reduce((s, e) => s + e.cost, 0);
    const byProvider = new Map<string, { calls: number; cost: number; times: number[] }>();
    for (const e of events) {
      const key = `${e.provider ?? 'unknown'}${e.kind.startsWith('test-') ? ' (tests)' : ''}`;
      const cur = byProvider.get(key) ?? { calls: 0, cost: 0, times: [] };
      byProvider.set(key, { calls: cur.calls + 1, cost: cur.cost + e.cost, times: e.ms ? [...cur.times, e.ms] : cur.times });
    }
    return { total, tests, gens: gens.length, failed, images, analysis: total - images, average: gens.length ? total / gens.length : 0, byProvider: [...byProvider.entries()].sort((a, b) => b[1].cost - a[1].cost) };
  }, [events]);

  return (
    <section className="mt-6 space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          Period
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-wb border border-line bg-white px-2 py-1.5 text-sm font-normal">
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={0}>Everything</option>
          </select>
        </label>
        <button type="button" onClick={load} disabled={busy} className="flex items-center gap-1.5 text-sm font-semibold text-brand disabled:opacity-50">
          <RefreshCw size={15} className={busy ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {view?.storage === 'memory' && (
        <p className="rounded-wb border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Temporary history.</strong> Records are kept in memory only and disappear when the server restarts (and Render restarts a free app after 15 minutes
          without visitors). To keep them for good, add <code>SUPABASE_URL</code> and <code>SUPABASE_SERVICE_KEY</code> on Render (steps in DEPLOY.md, “Cost history”).
        </p>
      )}
      {view?.lastError && (
        <p className="flex items-start gap-2 rounded-wb border border-brand bg-white p-4 text-sm text-brand">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" /> The history database reported a problem: {view.lastError}
        </p>
      )}
      {error && <p className="text-sm font-semibold text-brand">{error}</p>}

      {view && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ['Total cost', money(summary.total), 'all API calls of visitors'],
              ['Generations', String(summary.gens), summary.failed ? `${summary.failed} failed` : 'with a result'],
              ['Average per generation', money(summary.average), 'including depth map and roof mask'],
              ['Admin tests', money(summary.tests), 'not in the total'],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-wb border border-line bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
                <p className="mt-1 text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted">{note}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted">
            Images {money(summary.images)} · depth maps, roof masks and measurements {money(summary.analysis)}. All costs are estimates from the price table below.
          </p>

          <div>
            <h2 className="border-b border-line pb-2 text-lg font-bold">By service</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted">
                  <th className="py-1.5 font-semibold">Service</th>
                  <th className="py-1.5 text-right font-semibold">Calls</th>
                  <th className="py-1.5 text-right font-semibold">Typical time</th>
                  <th className="py-1.5 text-right font-semibold">Fastest – slowest</th>
                  <th className="py-1.5 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byProvider.map(([name, v]) => (
                  <tr key={name} className="border-t border-line">
                    <td className="py-1.5">{name}</td>
                    <td className="py-1.5 text-right">{v.calls}</td>
                    <td className="py-1.5 text-right">{v.times.length ? seconds([...v.times].sort((a, b) => a - b)[v.times.length >> 1]) : '–'}</td>
                    <td className="py-1.5 text-right text-muted">{v.times.length ? `${seconds(Math.min(...v.times))} – ${seconds(Math.max(...v.times))}` : '–'}</td>
                    <td className="py-1.5 text-right font-semibold">{money(v.cost)}</td>
                  </tr>
                ))}
                {summary.byProvider.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-muted">
                      Nothing recorded in this period yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h2 className="border-b border-line pb-2 text-lg font-bold">History</h2>
            <p className="mt-2 text-sm text-muted">
              Newest first. Open a row to see every API call. Previews are small and removed after {view.settings.retentionDays} days; the costs stay.
            </p>
            <ul className="mt-3">
              {groups.map((g) => (
                <li key={g.key} className="mt-4 first:mt-0">
                  <VisitHeader group={g} visits={visits} />
                  <ul className="divide-y divide-line">
                    {g.rows.map((row) => (
                      <HistoryRow key={row.key} row={row} visits={visits} measures={measures} open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
            {rows.length > shown && (
              <SecondaryButton onClick={() => setShown(shown + 40)} className="mt-3 sm:w-48">
                Show more
              </SecondaryButton>
            )}
          </div>

          <PriceTable password={password} settings={view.settings} active={view.activePrices ?? []} onSaved={(r) => { onSaved(r); void load(); }} />
        </>
      )}
    </section>
  );
}

function HistoryRow({ row, visits, measures, open, onToggle }: { row: Row; visits: Map<string, Visit>; measures: Map<string, UsageEvent>; open: boolean; onToggle: () => void }) {
  const { head } = row;
  const visitor = visitorOf(head);
  const visit = visitor?.session ? visits.get(visitor.session) : undefined;
  const isGen = GENERATION.has(head.kind);
  const failed = isGen && !(head.results ?? 0);
  const previews = row.calls.find((c) => c.previews)?.previews;
  return (
    <li className="py-3">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 text-left">
        {open ? <ChevronDown size={16} className="mt-1 shrink-0 text-muted" /> : <ChevronRight size={16} className="mt-1 shrink-0 text-muted" />}
        <div className="flex shrink-0 gap-1">
          {previews?.house && <img src={previews.house} alt="" className="h-12 w-16 rounded-[2px] border border-line object-cover" />}
          {previews?.results?.slice(0, 2).map((src, i) => (
            <img key={i} src={src} alt="" className="hidden h-12 w-16 rounded-[2px] border border-line object-cover sm:block" />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {isGen ? head.product || 'Generation' : KIND_LABEL[head.kind] ?? head.kind}
            {head.kind.startsWith('test-') && <span className="ml-2 rounded-[2px] bg-paper px-1.5 text-[11px] font-bold uppercase text-muted">test</span>}
            {failed && <span className="ml-2 rounded-[2px] bg-brand px-1.5 text-[11px] font-bold uppercase text-white">failed</span>}
          </p>
          <p className="truncate text-xs text-muted">
            {when(head.created_at)} · {head.provider}
            {isGen && ` · ${head.results ?? 0} result${head.results === 1 ? '' : 's'}`}
            {head.ms ? ` · ${(head.ms / 1000).toFixed(1)} s` : ''}
          </p>
          {visitor && (
            <p className="truncate text-xs text-muted">
              {[place(visitor), visitor.device, visitor.sessionSeconds !== undefined && `${minutes(visitor.sessionSeconds)} into visit`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <p className="shrink-0 text-sm font-bold">{money(row.total)}</p>
      </button>
      {open && (
        <div className="ml-7 mt-3 space-y-3 rounded-wb bg-paper p-3 text-xs">
          {previews && (
            <div className="flex flex-wrap gap-2">
              {previews.house && <img src={previews.house} alt="House photo" className="h-24 rounded-[2px] border border-line" />}
              {previews.results?.map((src, i) => (
                <img key={i} src={src} alt={`Result ${i + 1}`} className="h-24 rounded-[2px] border border-line" />
              ))}
            </div>
          )}
          {visitor && (
            <p className="text-muted">
              <span className="font-semibold text-ink">Visitor</span> · IP {visitor.ip ?? 'unknown'} (anonymised)
              {place(visitor) && ` · ${place(visitor)}`}
              {visitor.device && ` · ${visitor.device}`}
              {visitor.session && ` · visit ${visitor.session.slice(0, 6)}`}
              {visit && ` · ${visit.generations} generation${visit.generations === 1 ? '' : 's'}, ${money(visit.cost)}, ${minutes(visit.seconds)} so far in this visit`}
            </p>
          )}
          {isGen && <MeasureInfo gen={head} measure={head.photo_id ? measures.get(head.photo_id) : undefined} />}
          <table className="w-full text-left">
            <tbody>
              {[...row.calls]
                .filter((c) => c.kind !== 'measure')
                .sort((a, b) => a.created_at.localeCompare(b.created_at))
                .map((c) => (
                  <tr key={String(c.id)} className="border-t border-line first:border-t-0">
                    <td className="py-1.5 pr-2 align-top font-semibold">{KIND_LABEL[c.kind] ?? c.kind}</td>
                    <td className="py-1.5 pr-2 align-top text-muted">
                      {c.provider}
                      {c.ms ? ` · ${(c.ms / 1000).toFixed(1)} s` : ''}
                      {detailText(c) && <span className="block">{detailText(c)}</span>}
                    </td>
                    <td className="py-1.5 text-right align-top font-semibold">{money(c.cost)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

function detailText(c: UsageEvent): string {
  const d = c.detail ?? {};
  const parts: string[] = [];
  if (Array.isArray(d.sent)) parts.push(`sent: ${(d.sent as string[]).join(', ')}`);
  if (typeof d.basis === 'string') parts.push(`estimate: ${d.basis}`);
  if (typeof d.quality === 'string') parts.push(`quality: ${d.quality}`);
  if (typeof d.error === 'string') parts.push(`error: ${d.error}`);
  return parts.join(' · ');
}

function PriceTable({ password, settings, active, onSaved }: { password: string; settings: UsageSettings; active: string[]; onSaved: (r: SaveResult) => void }) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setDraft(settings), [settings]);

  async function save() {
    setBusy(true);
    try {
      onSaved(await api<SaveResult>(password, 'PUT', '/api/admin/usage-settings', draft));
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="border-b border-line pb-2 text-lg font-bold">Price table</h2>
      <p className="mt-2 text-sm text-muted">
        Every cost above is an estimate: units used × these prices (US dollars). Change a price when a provider changes it; old records keep the cost they were
        saved with. Services your current AI settings use are highlighted.
      </p>
      <div className="mt-4 space-y-3">
        {draft.prices.map((p, i) => (
          <div
            key={p.id}
            className={`grid items-center gap-2 rounded-wb sm:grid-cols-[1fr_9rem] ${active.includes(p.id) ? 'border border-green-600 bg-green-50 p-3' : 'p-3'}`}
          >
            <div>
              <p className="text-sm font-semibold">
                {p.label}
                {active.includes(p.id) && (
                  <span className="ml-2 rounded-full bg-green-600 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-white">In use</span>
                )}
              </p>
              <p className="text-xs text-muted">
                per {p.unit}
                {p.note ? ` · ${p.note}` : ''}
              </p>
            </div>
            <label className="flex items-center gap-1 text-sm">
              $
              <input
                type="number"
                min={0}
                step="any"
                value={p.price}
                onChange={(e) => setDraft({ ...draft, prices: draft.prices.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)) })}
                className={`${fieldClass} !mt-0`}
              />
            </label>
          </div>
        ))}
      </div>
      <label className="mt-6 block max-w-xs text-sm font-semibold">
        Delete previews of visitors’ photos after (days)
        <input
          type="number"
          min={1}
          max={3650}
          value={draft.retentionDays}
          onChange={(e) => setDraft({ ...draft, retentionDays: Number(e.target.value) })}
          className={fieldClass}
        />
        <span className="mt-1 block text-xs font-normal text-muted">The costs stay. The privacy note on the start screen can be edited under App texts.</span>
      </label>
      {error && <p className="mt-3 text-sm font-semibold text-brand">{error}</p>}
      <div className="mt-4 flex gap-3">
        <SecondaryButton onClick={() => setDraft(settings)} disabled={busy} className="sm:w-40">
          Undo changes
        </SecondaryButton>
        <PrimaryButton onClick={save} disabled={busy} className="sm:w-48">
          {busy ? 'Saving…' : 'Save prices'}
        </PrimaryButton>
      </div>
    </div>
  );
}

interface MeasureDetail {
  confidence?: string;
  up?: string;
  scaleChecked?: boolean;
  focalPx?: number;
  roofAreaM2?: number;
  samCalls?: number;
  planes?: { pitchDeg: number; eaveM: number; slopeM: number; areaM2: number; share: number }[];
  notes?: string[];
  debug?: Record<string, string | number>;
  costLines?: { label: string; cost: number }[];
  depthThumb?: string;
}

/** Everything about the roof measurement of a generation's photo, in one drop-down. */
function MeasureInfo({ gen, measure }: { gen: UsageEvent; measure?: UsageEvent }) {
  const sentText = typeof gen.detail?.measurementText === 'string' ? gen.detail.measurementText : '';
  if (!measure && !sentText) return null;
  const d = (measure?.detail ?? {}) as MeasureDetail;
  const used = Boolean(sentText);
  return (
    <details className="rounded-wb border border-line bg-white p-3">
      <summary className="cursor-pointer text-xs font-semibold">
        Roof measurement
        <span className={`ml-2 rounded-[2px] px-1.5 py-0.5 text-[11px] font-bold uppercase ${used ? 'bg-emerald-100' : 'bg-paper text-muted'}`}>{used ? 'in the prompt' : 'not in the prompt'}</span>
        {measure && <span className="ml-2 font-normal text-muted">{measure.ms ? `${(measure.ms / 1000).toFixed(1)} s · ` : ''}{money(measure.cost)}</span>}
      </summary>
      <div className="mt-3 space-y-3 text-xs">
        {measure ? (
          <>
            <p>
              <span className="font-semibold">{d.confidence === 'ok' ? 'Reliable' : 'Not reliable'}</span> · {d.scaleChecked ? 'scale confirmed' : 'scale not confirmed (no sizes)'} · up from{' '}
              {d.up === 'wall' ? 'a wall' : 'a level camera'}
              {d.focalPx ? ` · focal length ${d.focalPx} px` : ''}
              {d.samCalls !== undefined ? ` · ${d.samCalls} SAM 3 call${d.samCalls === 1 ? '' : 's'} made` : ''}
            </p>
            {d.planes && d.planes.length > 0 && (
              <table className="w-full text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="pr-2">Plane</th>
                    <th className="pr-2">Pitch</th>
                    <th className="pr-2">Eave</th>
                    <th className="pr-2">Slope</th>
                    <th className="pr-2">Area</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {d.planes.map((p, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="pr-2">{i + 1}</td>
                      <td className="pr-2">{p.pitchDeg}°</td>
                      <td className="pr-2">{p.eaveM} m</td>
                      <td className="pr-2">{p.slopeM} m</td>
                      <td className="pr-2">{p.areaM2} m²</td>
                      <td>{Math.round(p.share * 100)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {d.costLines && d.costLines.length > 0 && (
              <div>
                <p className="font-semibold">What this measurement cost (estimates)</p>
                <table className="mt-1 w-full text-left">
                  <tbody>
                    {d.costLines.map((l, i) => (
                      <tr key={i} className="border-t border-line first:border-t-0">
                        <td className="py-1 pr-2">{l.label}</td>
                        <td className="py-1 text-right">{money(l.cost)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-line font-semibold">
                      <td className="py-1 pr-2">Total</td>
                      <td className="py-1 text-right">{money(d.costLines.reduce((s, l) => s + l.cost, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {d.notes && d.notes.length > 0 && (
              <ul className="list-disc pl-5 text-muted">
                {d.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            {d.depthThumb && (
              <div>
                <p className="font-semibold">Depth Pro depth (red = near, blue = far)</p>
                <img src={d.depthThumb} alt="Depth Pro depth" className="mt-1 h-40 rounded-[2px] border border-line" />
              </div>
            )}
            {d.debug && (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-muted">
                {Object.entries(d.debug).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="font-semibold">{k}</dt>
                    <dd>{String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </>
        ) : (
          <p className="text-muted">No measurement record was found for this photo (it may have been made before the records were kept).</p>
        )}
        <div>
          <p className="font-semibold">{used ? 'Text added to the prompt of this generation' : 'Nothing was added to the prompt of this generation'}</p>
          {used && <pre className="mt-1 whitespace-pre-wrap rounded-[2px] bg-paper p-2">{sentText}</pre>}
        </div>
      </div>
    </details>
  );
}
