import { useEffect, useMemo, useRef, useState } from 'react';
import type { SymbolUniverse } from '../hooks/useSymbolUniverse';
import type { MarketSymbol } from '../types/market';
import { formatCompact, formatPercent, formatPrice } from '../lib/format';

const MAX_RESULTS = 60;

export interface TickerSearchProps {
  universe: SymbolUniverse;
  selected: MarketSymbol;
  onSelect: (symbol: MarketSymbol) => void;
}

/**
 * Combobox over the venue's entire tradable universe (~1,400 markets).
 *
 * Results are ranked by match quality then by 24h turnover, so the liquid pair
 * is the first hit rather than an obscure one that merely shares a prefix.
 */
export function TickerSearch({ universe, selected, onSelect }: TickerSearchProps) {
  const [query, setQuery] = useState('');
  const [quoteFilter, setQuoteFilter] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(
    () => universe.search(query, quoteFilter, MAX_RESULTS),
    [universe, query, quoteFilter],
  );

  useEffect(() => setActiveIndex(0), [query, quoteFilter]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    if (!isOpen) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isOpen]);

  const commit = (symbol: MarketSymbol) => {
    onSelect(symbol);
    setQuery('');
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!isOpen && (event.key === 'ArrowDown' || event.key === 'Enter')) {
      setIsOpen(true);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const symbol = results[activeIndex];
      if (symbol) commit(symbol);
    }
  };

  const placeholder =
    universe.status === 'ready'
      ? `Search ${universe.symbols.length.toLocaleString('en-US')} markets`
      : 'Loading markets…';

  const emptyMessage =
    universe.status === 'error'
      ? (universe.error ?? 'Could not load markets')
      : universe.status === 'loading'
        ? 'Loading markets…'
        : 'No market matches that search';

  return (
    <div ref={containerRef} className="relative w-72">
      <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 focus-within:border-accent/60">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls="ticker-listbox"
          aria-autocomplete="list"
          value={query}
          placeholder={isOpen ? placeholder : selected.displaySymbol}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted"
        />
        {query !== '' && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="text-muted hover:text-fg"
          >
            &times;
          </button>
        )}
      </div>

      {isOpen && (
        <div className="absolute left-0 top-full z-30 mt-1 w-96 overflow-hidden rounded-md border border-line bg-panel shadow-2xl shadow-black/60">
          {universe.quoteAssets.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-line px-2 py-2">
              <FilterChip
                label="All"
                isActive={quoteFilter === null}
                onClick={() => setQuoteFilter(null)}
              />
              {universe.quoteAssets.map((asset) => (
                <FilterChip
                  key={asset}
                  label={asset}
                  isActive={quoteFilter === asset}
                  onClick={() => setQuoteFilter(quoteFilter === asset ? null : asset)}
                />
              ))}
            </div>
          )}

          <ul
            id="ticker-listbox"
            ref={listRef}
            role="listbox"
            className="scroll-slim max-h-80 overflow-y-auto"
          >
            {results.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-muted">{emptyMessage}</li>
            )}

            {results.map((symbol, index) => {
              const quote = universe.quotes.get(symbol.id);
              const isActive = index === activeIndex;
              const isSelected = symbol.id === selected.id;
              return (
                <li key={symbol.id} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(symbol)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                      isActive ? 'bg-elevated' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${isSelected ? 'text-accent' : 'text-fg'}`}
                      >
                        {symbol.displaySymbol}
                      </span>
                      <span className="block truncate text-[11px] uppercase tracking-wide text-muted">
                        {symbol.exchange} · vol {formatCompact(quote?.quoteVolume24h ?? 0)}
                      </span>
                    </span>
                    {quote && (
                      <span className="shrink-0 text-right">
                        <span className="block text-sm tabular-nums text-fg">
                          {formatPrice(quote.last, symbol.pricePrecision)}
                        </span>
                        <span
                          className={`block text-[11px] tabular-nums ${
                            quote.changePercent >= 0 ? 'text-up' : 'text-down'
                          }`}
                        >
                          {formatPercent(quote.changePercent)}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
        isActive ? 'bg-accent/15 text-accent' : 'bg-elevated text-muted hover:text-fg'
      }`}
    >
      {label}
    </button>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 fill-none stroke-muted stroke-[1.6]"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" strokeLinecap="round" />
    </svg>
  );
}
