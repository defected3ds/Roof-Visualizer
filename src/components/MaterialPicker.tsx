import { useMemo, useState } from 'react';
import { CATEGORIES } from '../materials';
import { productThumb } from '../lib/swatch';
import type { Category, Product } from '../types';

interface Props {
  products: Product[];
  selected: Product;
  onSelect: (p: Product) => void;
  disabled?: boolean;
}

export function MaterialPicker({ products, selected, onSelect, disabled }: Props) {
  const [filter, setFilter] = useState<Category | 'All'>(selected.category);
  const categories = CATEGORIES.filter((c) => products.some((p) => p.category === c));
  const items = useMemo(() => (filter === 'All' ? products : products.filter((p) => p.category === filter)), [filter, products]);

  return (
    <div className="space-y-4">
      <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line px-3">
        {(['All', ...categories] as const).map((c) => (
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
        {items.map((p) => {
          const active = p.id === selected.id;
          return (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => onSelect(p)}
              className={`flex w-32 shrink-0 snap-start flex-col overflow-hidden rounded-wb border bg-white text-left transition disabled:opacity-60 ${
                active ? 'border-brand shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line hover:shadow-md'
              }`}
            >
              <img src={productThumb(p)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              <span className="min-h-[3.25rem] px-2.5 py-2 text-[13px] leading-snug">
                {p.brand && <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">{p.brand}</span>}
                <span className={active ? 'font-semibold text-brand' : 'text-ink'}>{p.name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
