/**
 * Binance spot provider.
 *
 * This is the ONLY file that knows Binance URLs, payload shapes or interval
 * spellings. Everything it exposes is already normalized to the model in
 * `types/market.ts`.
 *
 * Transport split:
 *   REST      -> historical candles, symbol universe, 24h stats
 *   WebSocket -> live updates to the forming candle and to the 24h quote
 */

import type {
  CandleHandler,
  CandleRequest,
  MarketDataProvider,
  QuoteHandler,
  StatusHandler,
  Unsubscribe,
} from '../marketData';
import type {
  Candle,
  ConnectionStatus,
  MarketSymbol,
  Quote,
  Timeframe,
} from '../../types/market';

/**
 * `data-api.binance.vision` is Binance's public market-data mirror: no API key,
 * permissive CORS, and reachable from regions where `api.binance.com` is not.
 * Extra hosts act as failover.
 */
const REST_HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const WS_HOST = 'wss://data-stream.binance.vision';

const MAX_CANDLES_PER_REQUEST = 1000;

/**
 * Grace period before tearing down an idle socket. Switching symbol unsubscribes
 * the old stream a beat before the new one subscribes, so closing immediately
 * would rebuild the connection on every click.
 */
const IDLE_CLOSE_MS = 1500;

/** Our timeframes happen to match Binance's spelling, but the mapping stays explicit. */
const INTERVALS: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
};

/** Raw kline tuple: [openTime, open, high, low, close, volume, closeTime, ...]. */
type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

interface RawSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: Array<{ filterType: string; tickSize?: string }>;
}

interface RawMiniTicker {
  symbol: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  lastPrice: string;
  volume: string;
  quoteVolume: string;
}

/** Payload of the `<symbol>@kline_<interval>` stream. */
interface StreamKline {
  k: { t: number; o: string; h: string; l: string; c: string; v: string; x: boolean };
}

/** Payload of the `<symbol>@ticker` stream. */
interface StreamTicker {
  c: string;
  o: string;
  h: string;
  l: string;
  v: string;
  q: string;
  p: string;
  P: string;
}

function toNumber(value: string | number): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/** "0.00001000" -> 5. Drives the price scale's decimal places. */
function decimalsFromTickSize(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toFixed(12).replace(/0+$/, '');
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Try each host in turn so one blocked region does not take the app down. */
async function restGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const suffix = query ? `${path}?${query}` : path;

  let lastError: unknown;
  for (const host of REST_HOSTS) {
    try {
      const response = await fetch(`${host}${suffix}`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : 'unknown error';
  throw new Error(`Binance request failed for ${path}: ${detail}`);
}

/**
 * One multiplexed WebSocket for the whole app.
 *
 * Binance's combined-stream endpoint lets us add and drop streams on a live
 * socket, so switching symbol or timeframe costs a SUBSCRIBE frame instead of a
 * fresh connection. Reconnects use exponential backoff and replay whatever
 * streams are subscribed at that moment.
 */
class StreamHub {
  private socket: WebSocket | null = null;
  private readonly handlers = new Map<string, Set<(data: unknown) => void>>();
  private readonly statusListeners = new Set<StatusHandler>();
  private status: ConnectionStatus = 'idle';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRequestId = 1;

  subscribe(stream: string, handler: (data: unknown) => void): Unsubscribe {
    // A new subscriber cancels any pending idle shutdown.
    if (this.idleCloseTimer !== null) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }

    let listeners = this.handlers.get(stream);
    const isNewStream = !listeners;

    if (!listeners) {
      listeners = new Set();
      this.handlers.set(stream, listeners);
    }
    listeners.add(handler);

    if (!this.socket) {
      this.connect();
    } else if (isNewStream && this.socket.readyState === WebSocket.OPEN) {
      this.send('SUBSCRIBE', [stream]);
    }

    return () => {
      const current = this.handlers.get(stream);
      if (!current) return;
      current.delete(handler);
      if (current.size > 0) return;

      this.handlers.delete(stream);
      if (this.socket?.readyState === WebSocket.OPEN) this.send('UNSUBSCRIBE', [stream]);
      if (this.handlers.size === 0) this.scheduleIdleClose();
    };
  }

  subscribeStatus(listener: StatusHandler): Unsubscribe {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private send(method: 'SUBSCRIBE' | 'UNSUBSCRIBE', params: string[]): void {
    this.socket?.send(JSON.stringify({ method, params, id: this.nextRequestId++ }));
  }

  private connect(): void {
    const streams = [...this.handlers.keys()];
    if (streams.length === 0) return;

    this.setStatus(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');

    const socket = new WebSocket(`${WS_HOST}/stream?streams=${streams.join('/')}`);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      // Streams added while the socket was down are absent from the handshake URL.
      const missing = [...this.handlers.keys()].filter((s) => !streams.includes(s));
      if (missing.length > 0) this.send('SUBSCRIBE', missing);
    };

    socket.onerror = () => socket.close();

    socket.onmessage = (event) => {
      let payload: { stream?: string; data?: unknown };
      try {
        payload = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!payload.stream) return; // SUBSCRIBE / UNSUBSCRIBE acknowledgements
      const listeners = this.handlers.get(payload.stream);
      if (!listeners) return;
      for (const listener of listeners) listener(payload.data);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return; // superseded by a newer socket
      this.socket = null;
      if (this.handlers.size === 0) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.setStatus('reconnecting');
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  /** Close only if nothing has resubscribed by the time the grace period elapses. */
  private scheduleIdleClose(): void {
    if (this.idleCloseTimer !== null) return;
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (this.handlers.size === 0) this.disconnect();
    }, IDLE_CLOSE_MS);
  }

  private disconnect(): void {
    if (this.idleCloseTimer !== null) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setStatus('closed');
  }
}

export class BinanceProvider implements MarketDataProvider {
  readonly id = 'binance' as const;
  readonly label = 'Binance';
  readonly maxCandlesPerRequest = MAX_CANDLES_PER_REQUEST;

  private readonly hub = new StreamHub();
  private symbolsPromise: Promise<MarketSymbol[]> | null = null;
  private quotesPromise: Promise<Map<string, Quote>> | null = null;
  private quotesFetchedAt = 0;

  supportsTimeframe(timeframe: Timeframe): boolean {
    return timeframe in INTERVALS;
  }

  /**
   * Every live spot market on Binance (~1,400 pairs).
   *
   * `showPermissionSets=false` plus `symbolStatus=TRADING` shrink the response
   * from ~17 MB to ~2.5 MB (about 50 KB gzipped) and drop delisted pairs that
   * would otherwise render an empty chart. Cached for the session.
   */
  listSymbols(): Promise<MarketSymbol[]> {
    this.symbolsPromise ??= restGet<{ symbols: RawSymbol[] }>('/api/v3/exchangeInfo', {
      permissions: 'SPOT',
      showPermissionSets: 'false',
      symbolStatus: 'TRADING',
    })
      .then((payload) => payload.symbols.map((raw) => this.toMarketSymbol(raw)))
      .catch((error: unknown) => {
        this.symbolsPromise = null; // allow a retry
        throw error;
      });
    return this.symbolsPromise;
  }

  /** Bulk 24h stats for the venue; `type=MINI` trims fields we never read. */
  listQuotes(): Promise<Map<string, Quote>> {
    const isStale = Date.now() - this.quotesFetchedAt > 60_000;
    if (!this.quotesPromise || isStale) {
      this.quotesFetchedAt = Date.now();
      this.quotesPromise = restGet<RawMiniTicker[]>('/api/v3/ticker/24hr', { type: 'MINI' })
        .then((tickers) => {
          const quotes = new Map<string, Quote>();
          for (const ticker of tickers) {
            quotes.set(`${this.id}:${ticker.symbol}`, this.toQuote(ticker.symbol, ticker));
          }
          return quotes;
        })
        .catch((error: unknown) => {
          this.quotesPromise = null;
          this.quotesFetchedAt = 0;
          throw error;
        });
    }
    return this.quotesPromise;
  }

  async getCandles({ symbol, timeframe, limit, endTime }: CandleRequest): Promise<Candle[]> {
    const params: Record<string, string | number> = {
      symbol: symbol.symbol,
      interval: INTERVALS[timeframe],
      limit: Math.min(limit ?? MAX_CANDLES_PER_REQUEST, MAX_CANDLES_PER_REQUEST),
    };
    if (endTime !== undefined) params.endTime = Math.floor(endTime);

    const rows = await restGet<RawKline[]>('/api/v3/klines', params);
    return rows.map((row) => ({
      time: Math.floor(row[0] / 1000),
      open: toNumber(row[1]),
      high: toNumber(row[2]),
      low: toNumber(row[3]),
      close: toNumber(row[4]),
      volume: toNumber(row[5]),
    }));
  }

  subscribeCandles(
    symbol: MarketSymbol,
    timeframe: Timeframe,
    onCandle: CandleHandler,
  ): Unsubscribe {
    const stream = `${symbol.symbol.toLowerCase()}@kline_${INTERVALS[timeframe]}`;
    return this.hub.subscribe(stream, (data) => {
      const { k } = data as StreamKline;
      onCandle(
        {
          time: Math.floor(k.t / 1000),
          open: toNumber(k.o),
          high: toNumber(k.h),
          low: toNumber(k.l),
          close: toNumber(k.c),
          volume: toNumber(k.v),
        },
        k.x,
      );
    });
  }

  subscribeQuote(symbol: MarketSymbol, onQuote: QuoteHandler): Unsubscribe {
    const stream = `${symbol.symbol.toLowerCase()}@ticker`;
    return this.hub.subscribe(stream, (data) => {
      const t = data as StreamTicker;
      onQuote({
        symbolId: symbol.id,
        last: toNumber(t.c),
        open24h: toNumber(t.o),
        change: toNumber(t.p),
        changePercent: toNumber(t.P),
        high24h: toNumber(t.h),
        low24h: toNumber(t.l),
        volume24h: toNumber(t.v),
        quoteVolume24h: toNumber(t.q),
      });
    });
  }

  subscribeStatus(onStatus: StatusHandler): Unsubscribe {
    return this.hub.subscribeStatus(onStatus);
  }

  private toMarketSymbol(raw: RawSymbol): MarketSymbol {
    const priceFilter = raw.filters.find((f) => f.filterType === 'PRICE_FILTER');
    const tickSize = toNumber(priceFilter?.tickSize ?? '0.01') || 0.01;
    return {
      id: `${this.id}:${raw.symbol}`,
      exchange: this.id,
      symbol: raw.symbol,
      displaySymbol: `${raw.baseAsset}/${raw.quoteAsset}`,
      base: raw.baseAsset,
      quote: raw.quoteAsset,
      type: 'crypto',
      tickSize,
      pricePrecision: decimalsFromTickSize(tickSize),
    };
  }

  private toQuote(symbol: string, raw: RawMiniTicker): Quote {
    const last = toNumber(raw.lastPrice);
    const open = toNumber(raw.openPrice);
    const change = last - open;
    return {
      symbolId: `${this.id}:${symbol}`,
      last,
      open24h: open,
      change,
      changePercent: open > 0 ? (change / open) * 100 : 0,
      high24h: toNumber(raw.highPrice),
      low24h: toNumber(raw.lowPrice),
      volume24h: toNumber(raw.volume),
      quoteVolume24h: toNumber(raw.quoteVolume),
    };
  }
}
