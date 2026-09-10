/**
 * Market data abstraction + provider registry.
 *
 * UI code talks only to `marketData`. It never imports a venue implementation,
 * never knows a URL, and never sees an exchange-specific payload shape. Adding
 * Bybit or Bitget later means writing one class that satisfies
 * `MarketDataProvider` and calling `registerProvider` — no component changes.
 */

import type {
  Candle,
  ConnectionStatus,
  ExchangeId,
  MarketSymbol,
  Quote,
  Timeframe,
} from '../types/market';

export type Unsubscribe = () => void;

export interface CandleRequest {
  symbol: MarketSymbol;
  timeframe: Timeframe;
  /** Max bars to return. Providers clamp this to their own API limit. */
  limit?: number;
  /** Return bars strictly older than this unix-ms timestamp. Drives scroll-back paging. */
  endTime?: number;
}

/** Emitted on every live tick. `closed` marks the final update for that bar. */
export type CandleHandler = (candle: Candle, closed: boolean) => void;

export type QuoteHandler = (quote: Quote) => void;

export type StatusHandler = (status: ConnectionStatus) => void;

export interface MarketDataProvider {
  readonly id: ExchangeId;
  readonly label: string;
  /** Hard cap on bars per REST request, used by the paging logic. */
  readonly maxCandlesPerRequest: number;

  supportsTimeframe(timeframe: Timeframe): boolean;

  /** The full tradable universe for this venue. Implementations should cache. */
  listSymbols(): Promise<MarketSymbol[]>;

  /** Bulk 24h stats keyed by `MarketSymbol.id`. Used to rank search results. */
  listQuotes(): Promise<Map<string, Quote>>;

  getCandles(request: CandleRequest): Promise<Candle[]>;

  subscribeCandles(symbol: MarketSymbol, timeframe: Timeframe, onCandle: CandleHandler): Unsubscribe;

  subscribeQuote(symbol: MarketSymbol, onQuote: QuoteHandler): Unsubscribe;

  /** Observe the realtime transport so the UI can show a live/offline indicator. */
  subscribeStatus(onStatus: StatusHandler): Unsubscribe;
}

const registry = new Map<ExchangeId, MarketDataProvider>();

export function registerProvider(provider: MarketDataProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(exchange: ExchangeId): MarketDataProvider {
  const provider = registry.get(exchange);
  if (!provider) throw new Error(`No market data provider registered for "${exchange}"`);
  return provider;
}

export function listProviders(): MarketDataProvider[] {
  return [...registry.values()];
}

/**
 * Facade that routes each call to the provider owning the symbol. Because the
 * exchange travels with the symbol, a multi-venue watchlist needs no extra
 * plumbing here.
 */
export const marketData = {
  listProviders,

  async listSymbols(exchange?: ExchangeId): Promise<MarketSymbol[]> {
    const providers = exchange ? [getProvider(exchange)] : listProviders();
    const results = await Promise.all(
      providers.map((p) => p.listSymbols().catch(() => [] as MarketSymbol[])),
    );
    return results.flat();
  },

  async listQuotes(exchange?: ExchangeId): Promise<Map<string, Quote>> {
    const providers = exchange ? [getProvider(exchange)] : listProviders();
    const results = await Promise.all(
      providers.map((p) => p.listQuotes().catch(() => new Map<string, Quote>())),
    );
    const merged = new Map<string, Quote>();
    for (const map of results) for (const [id, quote] of map) merged.set(id, quote);
    return merged;
  },

  getCandles(request: CandleRequest): Promise<Candle[]> {
    return getProvider(request.symbol.exchange).getCandles(request);
  },

  subscribeCandles(symbol: MarketSymbol, timeframe: Timeframe, onCandle: CandleHandler): Unsubscribe {
    return getProvider(symbol.exchange).subscribeCandles(symbol, timeframe, onCandle);
  },

  subscribeQuote(symbol: MarketSymbol, onQuote: QuoteHandler): Unsubscribe {
    return getProvider(symbol.exchange).subscribeQuote(symbol, onQuote);
  },

  subscribeStatus(exchange: ExchangeId, onStatus: StatusHandler): Unsubscribe {
    return getProvider(exchange).subscribeStatus(onStatus);
  },
};
