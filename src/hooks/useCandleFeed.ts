import { useCallback, useEffect, useRef, useState } from 'react';
import { marketData } from '../services/marketData';
import type { Candle, MarketSymbol, Timeframe } from '../types/market';

const INITIAL_LIMIT = 1000;
const PAGE_LIMIT = 1000;

export interface CandleFeed {
  /** Settled history, ascending by time. Changes only on load or bar close. */
  candles: Candle[];
  /** The bar currently forming. Ticks several times a second; kept out of `candles`
   *  so a live tick never forces the chart to re-seed its whole dataset. */
  liveBar: Candle | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadOlder: () => void;
  retry: () => void;
}

function mergeClosedBar(candles: Candle[], bar: Candle): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  if (bar.time < last.time) return candles;
  if (bar.time === last.time) return [...candles.slice(0, -1), bar];
  return [...candles, bar];
}

/**
 * Owns the two-transport lifecycle for one (symbol, timeframe) pair:
 * REST for settled history plus scroll-back paging, WebSocket for the live bar.
 */
export function useCandleFeed(symbol: MarketSymbol, timeframe: Timeframe): CandleFeed {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [liveBar, setLiveBar] = useState<Candle | null>(null);
  const [status, setStatus] = useState<CandleFeed['status']>('loading');
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  /** Bumped on every symbol/timeframe change so in-flight responses can be discarded. */
  const requestRef = useRef(0);
  const candlesRef = useRef<Candle[]>([]);
  /** Lets effects key on the stable id while still reading the latest symbol object. */
  const symbolRef = useRef(symbol);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  candlesRef.current = candles;
  symbolRef.current = symbol;

  useEffect(() => {
    const requestId = ++requestRef.current;
    let cancelled = false;

    setCandles([]);
    setLiveBar(null);
    setStatus('loading');
    setError(null);
    setHasMore(true);
    hasMoreRef.current = true;
    loadingMoreRef.current = false;
    setIsLoadingMore(false);

    marketData
      .getCandles({ symbol: symbolRef.current, timeframe, limit: INITIAL_LIMIT })
      .then((history) => {
        if (cancelled || requestId !== requestRef.current) return;
        setCandles(history);
        setStatus('ready');
        if (history.length < INITIAL_LIMIT) {
          setHasMore(false);
          hasMoreRef.current = false;
        }
      })
      .catch((cause: unknown) => {
        if (cancelled || requestId !== requestRef.current) return;
        setStatus('error');
        setError(cause instanceof Error ? cause.message : 'Failed to load market data');
      });

    return () => {
      cancelled = true;
    };
  }, [symbol.id, timeframe, reloadToken]);

  useEffect(() => {
    const requestId = requestRef.current;

    return marketData.subscribeCandles(symbolRef.current, timeframe, (bar, closed) => {
      if (requestId !== requestRef.current) return;
      if (closed) {
        setCandles((current) => mergeClosedBar(current, bar));
        setLiveBar(null);
      } else {
        setLiveBar(bar);
      }
    });
  }, [symbol.id, timeframe]);

  /** Page backwards from the oldest bar we hold. Called when the view nears the left edge. */
  const loadOlder = useCallback(() => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const oldest = candlesRef.current[0];
    if (!oldest) return;

    const requestId = requestRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    marketData
      .getCandles({
        symbol: symbolRef.current,
        timeframe,
        limit: PAGE_LIMIT,
        endTime: oldest.time * 1000 - 1,
      })
      .then((older) => {
        if (requestId !== requestRef.current) return;
        const fresh = older.filter((candle) => candle.time < oldest.time);
        if (fresh.length === 0) {
          setHasMore(false);
          hasMoreRef.current = false;
          return;
        }
        setCandles((current) => [...fresh, ...current]);
      })
      .catch(() => {
        if (requestId !== requestRef.current) return;
        setHasMore(false);
        hasMoreRef.current = false;
      })
      .finally(() => {
        if (requestId !== requestRef.current) return;
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      });
  }, [symbol.id, timeframe]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  return { candles, liveBar, status, error, isLoadingMore, hasMore, loadOlder, retry };
}
