import { TickerSearch } from './TickerSearch';
import { TimeframeSelector } from './TimeframeSelector';
import type { SymbolUniverse } from '../hooks/useSymbolUniverse';
import type { ConnectionStatus, MarketSymbol, Quote, Timeframe } from '../types/market';
import { formatCompact, formatPercent, formatPrice, formatSigned } from '../lib/format';

export interface HeaderProps {
  universe: SymbolUniverse;
  symbol: MarketSymbol;
  onSymbolChange: (symbol: MarketSymbol) => void;
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
  quote: Quote | null;
  connection: ConnectionStatus;
}

const CONNECTION_STYLES: Record<ConnectionStatus, { dot: string; label: string }> = {
  idle: { dot: 'bg-muted', label: 'Idle' },
  connecting: { dot: 'bg-amber-400', label: 'Connecting' },
  open: { dot: 'bg-up', label: 'Live' },
  reconnecting: { dot: 'bg-amber-400', label: 'Reconnecting' },
  closed: { dot: 'bg-down', label: 'Offline' },
};

export function Header({
  universe,
  symbol,
  onSymbolChange,
  timeframe,
  onTimeframeChange,
  quote,
  connection,
}: HeaderProps) {
  const isUp = (quote?.changePercent ?? 0) >= 0;
  const changeColor = isUp ? 'text-up' : 'text-down';
  const status = CONNECTION_STYLES[connection];

  return (
    <header className="shrink-0 border-b border-line bg-panel">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <span className="select-none text-sm font-semibold tracking-[0.18em] text-fg">
          TERMINAL
        </span>

        <TickerSearch universe={universe} selected={symbol} onSelect={onSymbolChange} />

        <TimeframeSelector value={timeframe} onChange={onTimeframeChange} />

        <div className="ml-auto flex items-center gap-1.5" title={`Realtime feed: ${status.label}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />
          <span className="text-[11px] uppercase tracking-wide text-muted">{status.label}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-line px-4 py-2">
        <div className="flex items-baseline gap-2">
          <h1 className="text-base font-semibold text-fg">{symbol.displaySymbol}</h1>
          <span className="text-[11px] uppercase tracking-wide text-muted">
            {symbol.exchange} · spot
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={`text-lg font-semibold tabular-nums ${changeColor}`}>
            {quote ? formatPrice(quote.last, symbol.pricePrecision) : '—'}
          </span>
          {quote && (
            <span className={`text-xs tabular-nums ${changeColor}`}>
              {formatSigned(quote.change, symbol.pricePrecision)} ({formatPercent(quote.changePercent)})
            </span>
          )}
        </div>

        <Stat label="24h High" value={quote ? formatPrice(quote.high24h, symbol.pricePrecision) : '—'} />
        <Stat label="24h Low" value={quote ? formatPrice(quote.low24h, symbol.pricePrecision) : '—'} />
        <Stat
          label={`24h Vol (${symbol.base})`}
          value={quote ? formatCompact(quote.volume24h) : '—'}
        />
        <Stat
          label={`24h Vol (${symbol.quote})`}
          value={quote ? formatCompact(quote.quoteVolume24h) : '—'}
        />
      </div>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-muted">{label}</span>
      <span className="text-xs tabular-nums text-fg">{value}</span>
    </div>
  );
}
