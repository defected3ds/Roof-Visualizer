import { useT } from '../lib/texts';

export interface HistoryItem {
  id: number;
  /** Name of the product these results were made with. */
  product: string;
  images: string[];
  /** Name of the AI model that made them. */
  model?: string;
}

interface Props {
  items: HistoryItem[];
  /** Id of the generation currently shown on the stage. */
  viewing: number | null;
  onOpen: (id: number) => void;
  disabled?: boolean;
}

/**
 * Small strip of earlier generations (newest first): one thumbnail per generation, a number when it holds
 * several results. Tapping one shows its results again. Scrolls sideways when there are many.
 */
export function History({ items, viewing, onOpen, disabled }: Props) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className="px-5 pb-4 lg:px-8">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-muted">{t('editor.history')}</p>
      <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0">
        {items.map((item) => {
          const active = item.id === viewing;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpen(item.id)}
              disabled={disabled}
              title={item.product}
              aria-label={`${item.product} (${item.images.length})`}
              aria-pressed={active}
              className={`relative h-14 w-[4.5rem] shrink-0 overflow-hidden rounded-wb border-2 bg-paper transition-opacity disabled:opacity-40 lg:h-16 lg:w-24 ${
                active ? 'border-brand' : 'border-line hover:border-muted'
              }`}
            >
              <img src={item.images[0]} alt="" className="h-full w-full object-cover" draggable={false} />
              {item.images.length > 1 && (
                <span className="absolute bottom-0.5 right-0.5 rounded-[2px] bg-black/65 px-1 text-[10px] font-bold leading-4 text-white">
                  {item.images.length}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1 pb-0.5 pt-3 text-left text-[9px] font-semibold leading-none text-white">
                {item.product}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
