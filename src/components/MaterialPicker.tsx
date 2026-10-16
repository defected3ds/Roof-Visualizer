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
    <div className="space-y-4">
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3">
        {(['All', ...CATEGORIES] as const).map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`shrink-0 border-b-[3px] px-3 pb-2.5 pt-1 text-[15px] transition ${
              filter === c ? 'border-brand font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 pb-1">
        {items.map((m) => {
          const active = m.id === selected.id;
          return (
            <button
              key={m.id}
              disabled={disabled}
              onClick={() => onSelect(m)}
              className={`flex w-32 shrink-0 snap-start flex-col overflow-hidden rounded-wb border bg-white text-left transition disabled:opacity-60 ${
                active ? 'border-brand shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line hover:shadow-md'
              }`}
            >
              <img src={renderSwatch(m)} alt="" className="aspect-square w-full object-cover" />
              <span className={`min-h-[3.25rem] px-2.5 py-2 text-[13px] leading-snug ${active ? 'font-semibold text-brand' : 'text-ink'}`}>
                {m.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
