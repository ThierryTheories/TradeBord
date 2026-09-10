import { useCallback, useEffect, useMemo, useState } from 'react';
import { marketData } from '../services/marketData';
import type { MarketSymbol, Quote } from '../types/market';

/** Chip order for the quote-asset filter; only those actually listed are shown. */
const PREFERRED_QUOTES = ['USDT', 'USDC', 'FDUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY'];
const MAX_CHIPS = 6;

/**
 * Settlement currencies a trader expects to see first. This ordering matters
 * because 24h turnover is denominated in the quote asset and is therefore NOT
 * comparable across currencies: ETH/IDR turns over ~10^11 rupiah while
 * ETH/USDT turns over ~10^8 dollars, so a naive volume sort would bury the pair
 * everyone actually wants.
 */
const QUOTE_RANK = new Map(
  ['USDT', 'USDC', 'FDUSD', 'USD1', 'TUSD', 'BTC', 'ETH', 'BNB', 'EUR'].map((asset, index) => [
    asset,
    index,
  ]),
);
const UNRANKED_QUOTE = QUOTE_RANK.size;

export interface SymbolUniverse {
  symbols: MarketSymbol[];
  quotes: Map<string, Quote>;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Quote assets offered as filter chips, most relevant first. */
  quoteAssets: string[];
  search: (query: string, quoteFilter: string | null, limit: number) => MarketSymbol[];
}

/**
 * Ranks a candidate against the query. Lower is better; `null` means no match.
 * Exact ticker beats exact base, which beats prefix, which beats substring — so
 * typing "BTC" surfaces BTC/USDT rather than, say, WBTC/USDT.
 */
function matchScore(symbol: MarketSymbol, query: string): number | null {
  if (symbol.symbol === query) return 0;
  if (symbol.base === query) return 1;
  if (symbol.base.startsWith(query)) return 2;
  if (symbol.symbol.startsWith(query)) return 3;
  if (symbol.base.includes(query)) return 4;
  if (symbol.symbol.includes(query)) return 5;
  return null;
}

/**
 * Loads the whole tradable universe once, plus 24h stats used to rank results.
 * Stats are a progressive enhancement: if that request fails the search still
 * works, just ordered alphabetically instead of by liquidity.
 */
export function useSymbolUniverse(): SymbolUniverse {
  const [symbols, setSymbols] = useState<MarketSymbol[]>([]);
  const [quotes, setQuotes] = useState<Map<string, Quote>>(() => new Map());
  const [status, setStatus] = useState<SymbolUniverse['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    marketData
      .listSymbols()
      .then((all) => {
        if (cancelled) return;
        setSymbols(all);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Failed to load symbols');
      });

    // Ranking data is heavier than the symbol list, so it lands independently.
    marketData
      .listQuotes()
      .then((all) => {
        if (!cancelled) setQuotes(all);
      })
      .catch(() => {
        /* ranking falls back to alphabetical */
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const quoteAssets = useMemo(() => {
    const listed = new Set(symbols.map((s) => s.quote));
    return PREFERRED_QUOTES.filter((asset) => listed.has(asset)).slice(0, MAX_CHIPS);
  }, [symbols]);

  const search = useCallback(
    (query: string, quoteFilter: string | null, limit: number): MarketSymbol[] => {
      const needle = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

      const liquidity = (symbol: MarketSymbol) => quotes.get(symbol.id)?.quoteVolume24h ?? 0;
      const scored: Array<{ symbol: MarketSymbol; score: number }> = [];

      for (const symbol of symbols) {
        if (quoteFilter && symbol.quote !== quoteFilter) continue;
        const score = needle === '' ? 0 : matchScore(symbol, needle);
        if (score === null) continue;
        scored.push({ symbol, score });
      }

      scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;

        const rankDiff =
          (QUOTE_RANK.get(a.symbol.quote) ?? UNRANKED_QUOTE) -
          (QUOTE_RANK.get(b.symbol.quote) ?? UNRANKED_QUOTE);
        if (rankDiff !== 0) return rankDiff;

        // Only meaningful between pairs settled in the same currency.
        if (a.symbol.quote === b.symbol.quote) {
          const byLiquidity = liquidity(b.symbol) - liquidity(a.symbol);
          if (byLiquidity !== 0) return byLiquidity;
        }
        return a.symbol.symbol.localeCompare(b.symbol.symbol);
      });

      return scored.slice(0, limit).map((entry) => entry.symbol);
    },
    [symbols, quotes],
  );

  return { symbols, quotes, status, error, quoteAssets, search };
}
