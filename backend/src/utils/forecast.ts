/**
 * The forecasting behind Analytics. Pure, so scripts/test-analytics.ts can pin
 * it down without a database.
 *
 * Two questions, two tools, because they have different data behind them:
 *
 * - "Where does this month land?" has a daily series of lumpy sales, full of
 *   RM0 days and the odd big order. A straight line through that is a guess
 *   with no range, so the rest of the month is simulated by resampling real
 *   recent days. The 10th to 90th percentile of those runs is the range shown.
 *
 * - "What do the next few months look like?" has a short monthly series. No
 *   single model suits every shape, so a few simple ones are replayed over the
 *   store's own history (rolling origin: fit on the months before, predict the
 *   next, score it) and the one that was actually closest wins. The range comes
 *   from that replay's own misses, not from a formula that assumes tidy data.
 */

/** Same seed, same numbers: a reload must not move the forecast. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return sorted[low] + (sorted[high] - sorted[low]) * (at - low);
}

export function median(values: readonly number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

export interface Range {
  expected: number;
  low: number;
  high: number;
}

const SIMULATIONS = 4000;
/** Each day back counts this much less, so last week outweighs last month. */
const DAY_DECAY = 0.98;
export const MIN_DAYS_FOR_LANDING = 7;

/**
 * Month-end landing. `recentDays` is oldest first and holds complete days only,
 * RM0 days included: dropping them would forecast as if every day sold.
 */
export function forecastLanding(recentDays: readonly number[], toDate: number, daysLeft: number): Range | null {
  if (recentDays.length < MIN_DAYS_FOR_LANDING) return null;
  if (daysLeft <= 0) return { expected: toDate, low: toDate, high: toDate };

  const weights = recentDays.map((_, i) => Math.pow(DAY_DECAY, recentDays.length - 1 - i));
  const cumulative: number[] = [];
  let sum = 0;
  for (const w of weights) cumulative.push((sum += w));

  const random = mulberry32(recentDays.length * 7919 + daysLeft * 104729);
  const pick = () => {
    const target = random() * sum;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return recentDays[lo];
  };

  const totals: number[] = [];
  for (let run = 0; run < SIMULATIONS; run++) {
    let total = toDate;
    for (let d = 0; d < daysLeft; d++) total += pick();
    totals.push(total);
  }
  totals.sort((a, b) => a - b);
  // The mean, not the median. Sales are skewed by the odd big order, and the
  // median of a skewed total reads low month after month.
  const expected = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
  return {
    expected,
    low: Math.min(expected, Math.round(quantile(totals, 0.1))),
    high: Math.max(expected, Math.round(quantile(totals, 0.9))),
  };
}

/* ---------- Monthly models. Each takes history and returns h steps ahead. */

type Model = (history: readonly number[], steps: number) => number[];

const lastValue: Model = (history, steps) => Array.from({ length: steps }, () => history[history.length - 1]);

const movingAverage: Model = (history, steps) => {
  const recent = history.slice(-3);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  return Array.from({ length: steps }, () => mean);
};

const PHI = 0.85;

function holtFit(history: readonly number[], alpha: number, beta: number) {
  let level = history[0];
  let trend = history.length > 1 ? history[1] - history[0] : 0;
  let squaredError = 0;
  for (let t = 1; t < history.length; t++) {
    const predicted = level + PHI * trend;
    squaredError += (history[t] - predicted) ** 2;
    const previousLevel = level;
    level = alpha * history[t] + (1 - alpha) * predicted;
    trend = beta * (level - previousLevel) + (1 - beta) * PHI * trend;
  }
  return { level, trend, squaredError };
}

/** Holt's linear trend, damped: a young store's growth does not compound forever. */
const dampedTrend: Model = (history, steps) => {
  let best = holtFit(history, 0.5, 0.2);
  for (const alpha of [0.2, 0.35, 0.5, 0.65, 0.8]) {
    for (const beta of [0.05, 0.15, 0.3, 0.5]) {
      const fit = holtFit(history, alpha, beta);
      if (fit.squaredError < best.squaredError) best = fit;
    }
  }
  const out: number[] = [];
  let damping = 0;
  for (let h = 1; h <= steps; h++) {
    damping += Math.pow(PHI, h);
    out.push(Math.max(0, best.level + damping * best.trend));
  }
  return out;
};

const MODELS: { key: string; label: string; fit: Model; minHistory: number }[] = [
  { key: 'last', label: 'Same as the latest month', fit: lastValue, minHistory: 1 },
  { key: 'average', label: 'Average of the last 3 months', fit: movingAverage, minHistory: 1 },
  { key: 'trend', label: 'Damped trend', fit: dampedTrend, minHistory: 3 },
];

export interface Backtest {
  /** Months replayed. */
  folds: number;
  /** Typical one-month miss, as a percentage of the real figure. */
  typicalMissPct: number;
  /** The same score for "next month = last month", the bar any model must beat. */
  naiveMissPct: number;
}

export interface MonthlyForecast {
  method: string;
  methodLabel: string;
  backtest: Backtest | null;
  /** Ahead of the last month in `history`, nearest first. */
  points: Range[];
}

const MIN_FOLDS = 3;
const SPARSE_RANGE = 0.4;
const FLOOR_RANGE = 0.15;

function replay(history: readonly number[], model: (typeof MODELS)[number]): number[] {
  const misses: number[] = [];
  for (let end = Math.max(2, model.minHistory); end < history.length; end++) {
    const actual = history[end];
    if (actual <= 0) continue;
    misses.push(Math.abs(model.fit(history.slice(0, end), 1)[0] - actual) / actual);
  }
  return misses;
}

export function forecastMonthly(history: readonly number[], steps: number): MonthlyForecast | null {
  if (history.length === 0) return null;

  const scored = MODELS.filter((m) => history.length >= m.minHistory).map((model) => {
    const misses = replay(history, model);
    return { model, misses, score: misses.length ? misses.reduce((a, b) => a + b, 0) / misses.length : Infinity };
  });
  const naive = scored.find((s) => s.model.key === 'last');
  const trustworthy = scored.filter((s) => s.misses.length >= MIN_FOLDS);
  // Fewer than three replays cannot rank anything, so the plainest model stands.
  const chosen = trustworthy.length > 0 ? trustworthy.reduce((a, b) => (b.score < a.score ? b : a)) : scored.find((s) => s.model.key === 'average') ?? scored[0];

  const hasBacktest = chosen.misses.length >= MIN_FOLDS;
  const sortedMisses = [...chosen.misses].sort((a, b) => a - b);
  const band = hasBacktest ? Math.max(FLOOR_RANGE, quantile(sortedMisses, 0.8)) : SPARSE_RANGE;

  const points = chosen.model.fit(history, steps).map((value, i) => {
    const spread = band * Math.sqrt(i + 1);
    return {
      expected: Math.round(value),
      low: Math.round(Math.max(0, value * (1 - spread))),
      high: Math.round(value * (1 + spread)),
    };
  });

  return {
    method: chosen.model.key,
    methodLabel: chosen.model.label,
    backtest: hasBacktest
      ? {
          folds: chosen.misses.length,
          typicalMissPct: Math.round(chosen.score * 1000) / 10,
          naiveMissPct: Math.round((naive?.score ?? chosen.score) * 1000) / 10,
        }
      : null,
    points,
  };
}

/** Compound monthly growth over a series, oldest first. Null when it cannot be read. */
export function compoundMonthlyGrowth(series: readonly number[]): number | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  if (first <= 0 || last <= 0) return null;
  return Math.round((Math.pow(last / first, 1 / (series.length - 1)) - 1) * 1000) / 10;
}
