import { useEffect, useMemo, useState } from 'react';
import { Chart } from './Chart';
import { Header } from './Header';
import { useCandleFeed } from '../hooks/useCandleFeed';
import { useConnectionStatus, useLiveQuote } from '../hooks/useLiveQuote';
import { useSymbolUniverse } from '../hooks/useSymbolUniverse';
import { formatCompact, formatPercent, formatPrice } from '../lib/format';
import type { Candle, MarketSymbol, Timeframe } from '../types/market';

/**
 * Rendered immediately so the chart can start loading before the ~1,400-symbol
 * universe arrives. Once it does, the identical entry replaces this one; because
 * the feed keys on `symbol.id`, that swap costs no extra request.
 */
const DEFAULT_SYMBOL: MarketSymbol = {
  id: 'binance:BTCUSDT',
  exchange: 'binance',
  symbol: 'BTCUSDT',
  displaySymbol: 'BTC/USDT',
  base: 'BTC',
  quote: 'USDT',
  type: 'crypto',
  tickSize: 0.01,
  pricePrecision: 2,
};

export function TradingDashboard() {
  const [symbol, setSymbol] = useState<MarketSymbol>(DEFAULT_SYMBOL);
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [hoveredBar, setHoveredBar] = useState<Candle | null>(null);

  const universe = useSymbolUniverse();
  const feed = useCandleFeed(symbol, timeframe);
  const connection = useConnectionStatus(symbol);
  const quote = useLiveQuote(symbol, universe.quotes.get(symbol.id));

  // Replace the bootstrap placeholder with the venue's canonical definition,
  // which carries the real tick size for the price scale.
  useEffect(() => {
    if (universe.status !== 'ready') return;
    setSymbol((current) => universe.symbols.find((s) => s.id === current.id) ?? current);
  }, [universe.status, universe.symbols]);

  // The legend follows the crosshair, falling back to the newest bar.
  const legendBar = useMemo(
    () => hoveredBar ?? feed.liveBar ?? feed.candles[feed.candles.length - 1] ?? null,
    [hoveredBar, feed.liveBar, feed.candles],
  );

  return (
    <div className="flex h-full flex-col bg-base">
      <Header
        universe={universe}
        symbol={symbol}
        onSymbolChange={setSymbol}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        quote={quote}
        connection={connection}
      />

      <main className="relative min-h-0 flex-1">
        <Chart
          symbol={symbol}
          timeframe={timeframe}
          candles={feed.candles}
          liveBar={feed.liveBar}
          onLoadOlder={feed.loadOlder}
          onHoverBar={setHoveredBar}
        />

        {legendBar && <ChartLegend symbol={symbol} bar={legendBar} />}

        {feed.isLoadingMore && (
          <div className="pointer-events-none absolute bottom-10 left-3 z-10 rounded bg-elevated/90 px-2 py-1 text-[11px] text-muted">
            Loading history…
          </div>
        )}

        {feed.status === 'loading' && (
          <div className="absolute inset-0 grid place-items-center bg-base/70 text-sm text-muted">
            Loading {symbol.displaySymbol}…
          </div>
        )}

        {feed.status === 'error' && (
          <div className="absolute inset-0 grid place-items-center bg-base/85">
            <div className="max-w-sm rounded-md border border-line bg-panel px-5 py-4 text-center">
              <p className="text-sm text-fg">Could not load {symbol.displaySymbol}</p>
              <p className="mt-1 text-xs text-muted">{feed.error}</p>
              <button
                type="button"
                onClick={feed.retry}
                className="mt-3 rounded border border-line px-3 py-1.5 text-xs text-fg hover:bg-elevated"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** Crosshair readout pinned to the top-left of the chart, as on a trading terminal. */
function ChartLegend({ symbol, bar }: { symbol: MarketSymbol; bar: Candle }) {
  const isUp = bar.close >= bar.open;
  const color = isUp ? 'text-up' : 'text-down';
  const changePercent = bar.open > 0 ? ((bar.close - bar.open) / bar.open) * 100 : 0;
  const price = (value: number) => formatPrice(value, symbol.pricePrecision);

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
      <span className="font-medium text-fg">{symbol.displaySymbol}</span>
      <LegendValue label="O" value={price(bar.open)} className={color} />
      <LegendValue label="H" value={price(bar.high)} className={color} />
      <LegendValue label="L" value={price(bar.low)} className={color} />
      <LegendValue label="C" value={price(bar.close)} className={color} />
      <span className={color}>{formatPercent(changePercent)}</span>
      <LegendValue label="Vol" value={formatCompact(bar.volume)} className="text-muted" />
    </div>
  );
}

function LegendValue({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className: string;
}) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-muted">{label}</span>
      <span className={className}>{value}</span>
    </span>
  );
}
