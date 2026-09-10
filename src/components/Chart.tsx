import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, MarketSymbol, Timeframe } from '../types/market';

const UP = '#26a69a';
const DOWN = '#ef5350';
const UP_VOLUME = 'rgba(38, 166, 154, 0.32)';
const DOWN_VOLUME = 'rgba(239, 83, 80, 0.32)';

/** How many bars to show on a freshly loaded market. */
const DEFAULT_VISIBLE_BARS = 160;
/** Blank bars kept to the right of the newest candle, TradingView style. */
const RIGHT_OFFSET_BARS = 8;
/** Page in more history once the view comes within this many bars of the oldest one. */
const LOAD_OLDER_THRESHOLD = 20;

export interface ChartProps {
  symbol: MarketSymbol;
  timeframe: Timeframe;
  candles: Candle[];
  liveBar: Candle | null;
  /** Called when the user pans near the left edge and older history is needed. */
  onLoadOlder: () => void;
  /** Bar under the crosshair, or null when the pointer leaves the chart. */
  onHoverBar?: (candle: Candle | null) => void;
}

function toBar(candle: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: candle.time as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function toVolumeBar(candle: Candle): HistogramData<UTCTimestamp> {
  return {
    time: candle.time as UTCTimestamp,
    value: candle.volume,
    color: candle.close >= candle.open ? UP_VOLUME : DOWN_VOLUME,
  };
}

/**
 * Presentational wrapper around Lightweight Charts.
 *
 * It owns no market data of its own — everything arrives through props — and it
 * deliberately avoids re-seeding the dataset on every render:
 *
 *   new market      -> setData + reset the viewport
 *   older bars      -> setData, then shift the logical range so the view stays put
 *   newer/last bar  -> series.update, which preserves zoom and scroll exactly
 */
export function Chart({
  symbol,
  timeframe,
  candles,
  liveBar,
  onLoadOlder,
  onHoverBar,
}: ChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  /** What the chart currently holds, so each render can pick the cheapest update. */
  const appliedRef = useRef({ key: '', firstTime: 0, lastTime: 0, length: 0 });

  // Latest values for the chart's own event handlers, which are registered once.
  const candlesRef = useRef<Candle[]>(candles);
  const onLoadOlderRef = useRef(onLoadOlder);
  const onHoverBarRef = useRef(onHoverBar);
  candlesRef.current = candles;
  onLoadOlderRef.current = onLoadOlder;
  onHoverBarRef.current = onHoverBar;

  const seriesKey = `${symbol.id}:${timeframe}`;

  // Created once; the chart instance outlives every symbol and timeframe change.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#0e1116' },
        textColor: '#8b95a5',
        fontFamily:
          "ui-sans-serif, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: '#161a21' },
        horzLines: { color: '#161a21' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#4b5563',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a3140',
        },
        horzLine: {
          color: '#4b5563',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a3140',
        },
      },
      rightPriceScale: {
        borderColor: '#222833',
        // Leave room at the bottom for the volume overlay.
        scaleMargins: { top: 0.08, bottom: 0.26 },
      },
      timeScale: {
        borderColor: '#222833',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: RIGHT_OFFSET_BARS,
      },
      // Wheel to zoom, drag to pan, pinch on touch, double-click an axis to reset.
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderUpColor: UP,
      borderDownColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });

    // Volume shares the pane but uses its own hidden scale, pinned to the bottom.
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
      visible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Page in older history when the viewport approaches the left edge.
    const timeScale = chart.timeScale();
    const handleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range) return;
      if (range.from < LOAD_OLDER_THRESHOLD) onLoadOlderRef.current();
    };
    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange);

    const handleCrosshair = (param: { time?: unknown }) => {
      const report = onHoverBarRef.current;
      if (!report) return;
      if (param.time === undefined) {
        report(null);
        return;
      }
      const time = param.time as number;
      report(candlesRef.current.find((candle) => candle.time === time) ?? null);
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    // Responsive: follow the container rather than the window, so panel layout
    // changes resize the chart too.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) chart.resize(width, height);
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange);
      chart.unsubscribeCrosshairMove(handleCrosshair);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      appliedRef.current = { key: '', firstTime: 0, lastTime: 0, length: 0 };
    };
  }, []);

  // Price scale precision follows the venue's tick size for the active market.
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({
      priceFormat: {
        type: 'price',
        precision: symbol.pricePrecision,
        minMove: symbol.tickSize,
      },
    });
  }, [symbol.pricePrecision, symbol.tickSize]);

  // Settled history: seed, prepend, or extend — whichever is cheapest.
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) return;

    const applied = appliedRef.current;
    const isNewMarket = applied.key !== seriesKey;

    if (candles.length === 0) {
      if (isNewMarket) {
        candleSeries.setData([]);
        volumeSeries.setData([]);
        appliedRef.current = { key: seriesKey, firstTime: 0, lastTime: 0, length: 0 };
      }
      return;
    }

    const bars = candles.map(toBar);
    const volumes = candles.map(toVolumeBar);
    const prependCount = isNewMarket
      ? 0
      : candles.findIndex((candle) => candle.time === applied.firstTime);

    if (isNewMarket || applied.length === 0 || prependCount === -1) {
      candleSeries.setData(bars);
      volumeSeries.setData(volumes);
      const from = Math.max(0, bars.length - DEFAULT_VISIBLE_BARS);
      chart.timeScale().setVisibleLogicalRange({ from, to: bars.length + RIGHT_OFFSET_BARS });
    } else if (prependCount > 0) {
      // Older bars shift every index, so re-anchor the viewport by that amount
      // and the user's position in history stays where they left it.
      const range = chart.timeScale().getVisibleLogicalRange();
      candleSeries.setData(bars);
      volumeSeries.setData(volumes);
      if (range) {
        chart.timeScale().setVisibleLogicalRange({
          from: range.from + prependCount,
          to: range.to + prependCount,
        });
      }
    } else {
      // Appended and/or newly closed bars: update in place to preserve zoom and scroll.
      for (let i = Math.max(0, applied.length - 1); i < bars.length; i += 1) {
        candleSeries.update(bars[i]);
        volumeSeries.update(volumes[i]);
      }
    }

    appliedRef.current = {
      key: seriesKey,
      firstTime: candles[0].time,
      lastTime: candles[candles.length - 1].time,
      length: candles.length,
    };
  }, [candles, seriesKey]);

  // Live bar: high frequency, and never allowed to rewrite settled history.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || !liveBar) return;

    const applied = appliedRef.current;
    if (applied.key !== seriesKey || applied.length === 0) return;
    if (liveBar.time < applied.lastTime) return;

    candleSeries.update(toBar(liveBar));
    volumeSeries.update(toVolumeBar(liveBar));
  }, [liveBar, seriesKey]);

  return <div ref={containerRef} className="h-full w-full" />;
}
