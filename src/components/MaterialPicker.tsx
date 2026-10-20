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
  // "All" lists the products category by category, in the category order and the product order set in the admin.
  const items = useMemo(() => {
    if (filter !== 'all') return products.filter((p) => p.category === filter);
    const rank = (id: string) => {
      const at = categories.findIndex((c) => c.id === id);
      return at < 0 ? categories.length : at;
    };
    return products.map((p, i) => [p, i] as const).sort((a, b) => rank(a[0].category) - rank(b[0].category) || a[1] - b[1]).map(([p]) => p);
  }, [filter, products, categories]);
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
      {/* Category chips: one swipeable row on phones, a wrapped block on desktop. Same weight when selected, so nothing shifts. */}
      <div
        ref={tabRow}
        className="no-scrollbar flex shrink-0 gap-2 overflow-x-auto px-4 pb-1 [mask-image:linear-gradient(to_right,black_88%,transparent)] lg:flex-wrap lg:overflow-visible lg:border-b lg:border-line lg:px-5 lg:pb-4 lg:[mask-image:none]"
      >
        {[{ id: 'all', name: t('editor.all') }, ...tabs].map((c) => {
          const on = filter === c.id;
          const count = c.id === 'all' ? products.length : products.filter((p) => p.category === c.id).length;
          return (
            <button
              key={c.id}
              onClick={(e) => choose(c.id, e.currentTarget)}
              aria-pressed={on}
              className={`flex shrink-0 items-center gap-1.5 rounded-wb border px-3 py-1.5 text-sm font-medium transition ${
                on ? 'border-brand bg-brand text-white' : 'border-line bg-white text-ink hover:border-brand hover:text-brand'
              }`}
            >
              {c.name}
              <span className={`text-xs tabular-nums ${on ? 'text-white/75' : 'text-muted'}`}>{count}</span>
            </button>
          );
        })}
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
