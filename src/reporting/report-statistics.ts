export interface ObservedStatistics {
  readonly mean: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
  readonly standardDeviation: number;
  readonly sampleCount: number;
}

export function calculateObservedStatistics(values: readonly number[]): ObservedStatistics {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) {
    throw new TypeError("Observed statistics require finite samples");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2
      : (sorted[middle] as number);
  const variance =
    sorted.length === 1
      ? 0
      : sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1);
  return Object.freeze({
    mean,
    median,
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    standardDeviation: Math.sqrt(variance),
    sampleCount: sorted.length,
  });
}

export function calculateWilsonInterval(
  successes: number,
  total: number,
): readonly [number, number] {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(total) ||
    total < 1 ||
    successes < 0 ||
    successes > total
  ) {
    throw new TypeError("Wilson interval requires valid observation counts");
  }
  const proportion = successes / total;
  const z = 1.96;
  const denominator = 1 + (z * z) / total;
  const center = (proportion + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * total)) / total)) / denominator;
  return Object.freeze([Math.max(0, center - margin) * 100, Math.min(1, center + margin) * 100]);
}

export function calculateNearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number {
  if (
    values.length === 0 ||
    values.some((value) => !Number.isFinite(value)) ||
    percentile <= 0 ||
    percentile > 1
  ) {
    throw new TypeError("Nearest-rank percentile requires finite observations");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return sorted[index] as number;
}
