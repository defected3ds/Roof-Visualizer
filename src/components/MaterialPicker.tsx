import { useMemo, useRef, useState } from 'react';
import { useT } from '../lib/texts';
import { productThumb } from '../lib/swatch';
import type { Category, Product } from '../types';

interface Props {
  categories: Category[];
  products: Product[];
  selected: Product;
  onSelect: (p: Product) => void;
  disabled?: boolean;
}

export function MaterialPicker({ categories, products, selected, onSelect, disabled }: Props) {
  const t = useT();
  const [filter, setFilter] = useState<string>(selected.category);
  const tabs = categories.filter((c) => products.some((p) => p.category === c.id));
  const items = useMemo(() => (filter === 'all' ? products : products.filter((p) => p.category === filter)), [filter, products]);
  const tabRow = useRef<HTMLDivElement>(null);
  const productList = useRef<HTMLDivElement>(null);

  function choose(id: string, tab: HTMLButtonElement) {
    setFilter(id);
    // Start the new category from its first product.
    productList.current?.scrollTo({ left: 0, top: 0 });
    // Bring a partly hidden tab into view, horizontally only (scrollIntoView could move the page).
    const row = tabRow.current;
    if (row && row.scrollWidth > row.clientWidth) {
      const left = tab.offsetLeft - row.offsetLeft;
      if (left < row.scrollLeft || left + tab.offsetWidth > row.scrollLeft + row.clientWidth * 0.85) {
        row.scrollTo({ left: Math.max(0, left - 24), behavior: 'smooth' });
      }
    }
  }

  return (
    <div className="space-y-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:space-y-0">
      <div ref={tabRow} className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 [mask-image:linear-gradient(to_right,black_88%,transparent)] lg:flex-wrap lg:overflow-visible lg:px-4 lg:[mask-image:none]">
        {[{ id: 'all', name: t('editor.all') }, ...tabs].map((c) => (
          <button
            key={c.id}
            onClick={(e) => choose(c.id, e.currentTarget)}
            className={`shrink-0 border-b-[3px] px-3 pb-2.5 pt-1 text-[15px] transition ${
              filter === c.id ? 'border-brand font-semibold text-ink' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {/* The hidden bold copy reserves the bold width, so tabs don't shift when the selection changes. */}
            <span className="grid">
              <span aria-hidden className="invisible col-start-1 row-start-1 h-0 font-semibold">
                {c.name}
              </span>
              <span className="col-start-1 row-start-1">{c.name}</span>
            </span>
          </button>
        ))}
      </div>
      {/* Phone: one swipeable row. Desktop: a scrollable grid filling the side panel. */}
      <div ref={productList} className="no-scrollbar flex snap-x gap-3 overflow-x-auto px-4 pb-1 lg:grid lg:min-h-0 lg:flex-1 lg:auto-rows-max lg:grid-cols-3 lg:content-start lg:overflow-y-auto lg:overflow-x-hidden lg:py-4 lg:[scrollbar-width:thin]">
        {items.map((p) => {
          const active = p.id === selected.id;
          return (
            <button
              key={p.id}
              disabled={disabled}
              onClick={() => onSelect(p)}
              title={[p.brand, p.name].filter(Boolean).join(' ')}
              className={`flex w-36 shrink-0 snap-start flex-col lg:w-auto overflow-hidden rounded-wb border bg-white text-left transition disabled:opacity-60 ${
                active ? 'border-brand shadow-[0_0_0_1px_var(--color-brand)]' : 'border-line hover:shadow-md'
              }`}
            >
              <img src={productThumb(p)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
              {/* Fixed height: brand line + up to three name lines, so every card is the same size. */}
              <span className="flex h-[5.25rem] flex-col px-2.5 py-2 text-[13px] leading-[1.15rem]">
                <span className="block h-4 truncate text-[11px] font-semibold uppercase leading-4 tracking-wide text-muted">{p.brand}</span>
                <span className={`line-clamp-3 break-words ${active ? 'font-semibold text-brand' : 'text-ink'}`}>{p.name}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
