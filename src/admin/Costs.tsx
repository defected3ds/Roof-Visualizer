import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, TriangleAlert } from 'lucide-react';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import type { UsageEvent, UsageSettings, UsageView } from '../types';
import { api, fieldClass, type SaveResult } from './Admin';

const money = (v: number) => `$${v.toFixed(v === 0 ? 2 : v < 0.1 ? 4 : 3)}`;
const GENERATION = new Set(['image', 'test-image']);
const KIND_LABEL: Record<string, string> = {
  image: 'Image',
  'test-image': 'Image (test)',
  depth: 'Depth map',
  'test-depth': 'Depth map (test)',
  'roof-mask': 'Roof mask',
  'test-roof-mask': 'Roof mask (test)',
};

interface Row {
  key: string;
  head: UsageEvent;
  calls: UsageEvent[];
  total: number;
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
    const row = target ? rows.get(`g${target.id}`) : undefined;
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

  const events = view?.events ?? [];
  const rows = useMemo(() => buildRows(events), [events]);
  const summary = useMemo(() => {
    const real = events.filter((e) => !e.kind.startsWith('test-'));
    const total = real.reduce((s, e) => s + e.cost, 0);
    const tests = events.filter((e) => e.kind.startsWith('test-')).reduce((s, e) => s + e.cost, 0);
    const gens = real.filter((e) => e.kind === 'image' && (e.results ?? 0) > 0);
    const failed = real.filter((e) => e.kind === 'image' && !(e.results ?? 0)).length;
    const images = real.filter((e) => e.kind === 'image').reduce((s, e) => s + e.cost, 0);
    const byProvider = new Map<string, { calls: number; cost: number }>();
    for (const e of events) {
      const key = `${e.provider ?? 'unknown'}${e.kind.startsWith('test-') ? ' (tests)' : ''}`;
      const cur = byProvider.get(key) ?? { calls: 0, cost: 0 };
      byProvider.set(key, { calls: cur.calls + 1, cost: cur.cost + e.cost });
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
            Images {money(summary.images)} · depth maps and roof masks {money(summary.analysis)}. All costs are estimates from the price table below.
          </p>

          <div>
            <h2 className="border-b border-line pb-2 text-lg font-bold">By service</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted">
                  <th className="py-1.5 font-semibold">Service</th>
                  <th className="py-1.5 text-right font-semibold">Calls</th>
                  <th className="py-1.5 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {summary.byProvider.map(([name, v]) => (
                  <tr key={name} className="border-t border-line">
                    <td className="py-1.5">{name}</td>
                    <td className="py-1.5 text-right">{v.calls}</td>
                    <td className="py-1.5 text-right font-semibold">{money(v.cost)}</td>
                  </tr>
                ))}
                {summary.byProvider.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-3 text-muted">
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
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {rows.slice(0, shown).map((row) => (
                <HistoryRow key={row.key} row={row} open={open === row.key} onToggle={() => setOpen(open === row.key ? null : row.key)} />
              ))}
            </ul>
            {rows.length > shown && (
              <SecondaryButton onClick={() => setShown(shown + 40)} className="mt-3 sm:w-48">
                Show more
              </SecondaryButton>
            )}
          </div>

          <PriceTable password={password} settings={view.settings} onSaved={(r) => { onSaved(r); void load(); }} />
        </>
      )}
    </section>
  );
}

function HistoryRow({ row, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
  const { head } = row;
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
          <table className="w-full text-left">
            <tbody>
              {[...row.calls]
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

function PriceTable({ password, settings, onSaved }: { password: string; settings: UsageSettings; onSaved: (r: SaveResult) => void }) {
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
        saved with.
      </p>
      <div className="mt-4 space-y-3">
        {draft.prices.map((p, i) => (
          <div key={p.id} className="grid items-center gap-2 sm:grid-cols-[1fr_9rem]">
            <div>
              <p className="text-sm font-semibold">{p.label}</p>
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
