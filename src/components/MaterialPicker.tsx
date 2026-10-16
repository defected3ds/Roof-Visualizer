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
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3">
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`shrink-0 border-b-2 px-3 pb-2 pt-1 text-[15px] transition ${
              filter === c ? 'border-white font-semibold text-white' : 'border-transparent text-mist hover:text-white'
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
              className={`relative aspect-[4/5] w-32 shrink-0 snap-start overflow-hidden outline-offset-2 transition disabled:opacity-60 ${
                active ? 'outline-2 outline-white' : 'outline-0'
              }`}
            >
              <img src={renderSwatch(m)} alt="" className="absolute inset-0 h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink via-ink/70 to-transparent px-2 pb-2.5 pt-8 text-left text-[13px] leading-tight text-white">
                <span className={active ? 'font-semibold' : ''}>{m.name}</span>
              </span>
              {active && <span className="absolute inset-x-0 top-0 h-1 bg-brand" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
