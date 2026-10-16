import { useMemo, useState } from 'react';
import { CATEGORIES, MATERIALS } from '../materials';
import { renderSwatch } from '../lib/swatch';
import type { Category, Material } from '../types';

interface Props {
  selected: Material;
  onSelect: (m: Material) => void;
  disabled?: boolean;
}

export function MaterialPicker({ selected, onSelect, disabled }: Props) {
  const [filter, setFilter] = useState<Category | 'All'>(selected.category);
  const items = useMemo(() => (filter === 'All' ? MATERIALS : MATERIALS.filter((m) => m.category === filter)), [filter]);

  return (
    <div className="space-y-3">
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4">
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`shrink-0 rounded-2xl px-5 py-2.5 text-[15px] font-medium transition ${
              filter === c ? 'bg-sky-200 text-slate-900' : 'bg-white/10 text-white/80 hover:bg-white/15'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 py-1">
        {items.map((m) => {
          const active = m.id === selected.id;
          return (
            <button
              key={m.id}
              disabled={disabled}
              onClick={() => onSelect(m)}
              className={`relative aspect-[4/5] w-32 shrink-0 snap-start overflow-hidden rounded-2xl ring-offset-2 ring-offset-neutral-900 transition disabled:opacity-60 ${
                active ? 'ring-[3px] ring-white' : 'ring-0'
              }`}
            >
              <img src={renderSwatch(m)} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-2 pb-2.5 pt-8 text-center text-[13px] leading-tight text-white">
                <span className={active ? 'font-semibold' : ''}>{m.name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
