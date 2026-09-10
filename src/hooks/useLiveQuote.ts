import { useEffect, useState } from 'react';
import { marketData } from '../services/marketData';
import type { ConnectionStatus, MarketSymbol, Quote } from '../types/market';

/**
 * Header statistics for one instrument, seeded from the bulk REST snapshot and
 * then kept current by the venue's ticker stream.
 */
export function useLiveQuote(symbol: MarketSymbol, seed?: Quote): Quote | null {
  const [quote, setQuote] = useState<Quote | null>(seed ?? null);

  useEffect(() => {
    setQuote(seed?.symbolId === symbol.id ? seed : null);
    return marketData.subscribeQuote(symbol, setQuote);
    // `seed` is intentionally excluded: once the stream is live it owns the value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  return quote;
}

/** Realtime transport state for the venue, for the header's live indicator. */
export function useConnectionStatus(symbol: MarketSymbol): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('idle');

  useEffect(() => marketData.subscribeStatus(symbol.exchange, setStatus), [symbol.exchange]);

  return status;
}
