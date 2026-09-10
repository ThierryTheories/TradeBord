import { TIMEFRAMES, TIMEFRAME_LABELS, type Timeframe } from '../types/market';

export interface TimeframeSelectorProps {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}

export function TimeframeSelector({ value, onChange }: TimeframeSelectorProps) {
  return (
    <div
      role="group"
      aria-label="Timeframe"
      className="flex items-center gap-0.5 rounded-md border border-line bg-panel p-0.5"
    >
      {TIMEFRAMES.map((timeframe) => {
        const isActive = timeframe === value;
        return (
          <button
            key={timeframe}
            type="button"
            onClick={() => onChange(timeframe)}
            aria-pressed={isActive}
            className={`min-w-[2.25rem] rounded px-2 py-1 text-xs font-medium tabular-nums transition-colors ${
              isActive
                ? 'bg-accent/15 text-accent'
                : 'text-muted hover:bg-elevated hover:text-fg'
            }`}
          >
            {TIMEFRAME_LABELS[timeframe]}
          </button>
        );
      })}
    </div>
  );
}
