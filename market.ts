/**
 * Exchange-agnostic market data model.
 *
 * Nothing in this file may assume a particular venue. A symbol is only
 * meaningful together with the exchange it came from: "BTCUSDT" on Binance and
 * "BTCUSDT" on Bybit are different instruments with different tick sizes and
 * different order books, so `id` (exchange + native symbol) is the real key.
 */

export type ExchangeId = 'binance' | 'bybit' | 'bitget';

export type AssetType = 'crypto' | 'equity' | 'forex';

export interface MarketSymbol {
  /** Globally unique across venues, e.g. "binance:BTCUSDT". */
  id: string;
  exchange: ExchangeId;
  /** Native ticker as the exchange's API expects it, e.g. "BTCUSDT". */
  symbol: string;
  /** Human-readable form, e.g. "BTC/USDT". */
  displaySymbol: string;
  base: string;
  quote: string;
  type: AssetType;
  /** Smallest price increment on this market, e.g. 0.01. */
  tickSize: number;
  /** Decimal places to render prices with, derived from `tickSize`. */
  pricePrecision: number;
}

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;

export type Timeframe = (typeof TIMEFRAMES)[number];

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1H',
  '4h': '4H',
  '1d': '1D',
};

/** Bar duration in seconds. Used for gap detection and axis formatting. */
export const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

/** Normalized OHLCV bar. `time` is the bar's OPEN time as a UTC unix timestamp in SECONDS. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Rolling 24h statistics for one instrument. */
export interface Quote {
  symbolId: string;
  last: number;
  open24h: number;
  change: number;
  changePercent: number;
  high24h: number;
  low24h: number;
  /** Volume denominated in the base asset. */
  volume24h: number;
  /** Volume denominated in the quote asset — the meaningful cross-market ranking figure. */
  quoteVolume24h: number;
}

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
