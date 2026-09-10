/** Display helpers shared by the header, the search list and the chart legend. */

/** Price with the venue's own tick precision, thousands-separated. */
export function formatPrice(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/** Compact magnitude for volumes: 1.25B, 940.2M, 15.9K. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '—';
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ];
  for (const [scale, suffix] of units) {
    if (abs >= scale) return `${(value / scale).toFixed(2)}${suffix}`;
  }
  return value.toFixed(2);
}

/** Signed percentage, e.g. "+1.42%" / "-3.27%". */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatSigned(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value >= 0 ? '+' : ''}${formatPrice(value, precision)}`;
}
