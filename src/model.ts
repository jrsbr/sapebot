import type { Designated, Person } from './types';
import { addDays, daysBetween } from './time';
import { betaLowerBound } from './score';

export interface ModelParams {
  halfLifeDays: number;
  priorStrength: number;
}

export const DEFAULT_MODEL_PARAMS: ModelParams = {
  halfLifeDays: 90,
  priorStrength: 5,
};

const DEFAULT_PRIOR_MEAN = 0.8;
const LOWER_BOUND_Z = 0.84;
const LOSS_CLAMP = 0.02;
const WARMUP_DAYS = 21;
const MIN_ROWS_TO_FIT = 40;

const HALF_LIFE_GRID = [14, 30, 60, 90, 180, 365];
const PRIOR_GRID = [1, 2, 4, 8, 16];

export interface PersonProb {
  person_id: string;
  nome: string;
  prob: number;
  lower: number;
  evidence: number;
  n: number;
}

export interface BacktestResult {
  logLoss: number;
  brier: number;
  n: number;
}

export interface ModelFit {
  params: ModelParams;
  model: BacktestResult;
  baseline: BacktestResult;
  fitted: boolean;
}

export function outcomeValue(status: Designated['status']): number | null {
  if (status === 'done') return 1;
  if (status === 'late') return 0.5;
  if (status === 'missed') return 0;
  return null;
}

export function predictProbs(
  designated: Designated[],
  people: Person[],
  asOf: string,
  params: ModelParams = DEFAULT_MODEL_PARAMS,
): PersonProb[] {
  const acc = new Map<string, { s: number; f: number; n: number }>();
  for (const p of people) acc.set(p.person_id, { s: 0, f: 0, n: 0 });

  let totalS = 0;
  let totalF = 0;
  for (const d of designated) {
    const y = outcomeValue(d.status);
    if (y === null || d.data >= asOf) continue;
    const entry = acc.get(d.person_id);
    if (!entry) continue;
    const decay = Math.pow(0.5, daysBetween(d.data, asOf) / params.halfLifeDays);
    entry.s += decay * y;
    entry.f += decay * (1 - y);
    entry.n++;
    totalS += decay * y;
    totalF += decay * (1 - y);
  }

  const houseMean = totalS + totalF > 0 ? totalS / (totalS + totalF) : DEFAULT_PRIOR_MEAN;
  return people.map((p) => {
    const e = acc.get(p.person_id)!;
    const alpha = params.priorStrength * houseMean + e.s;
    const beta = params.priorStrength * (1 - houseMean) + e.f;
    return {
      person_id: p.person_id,
      nome: p.nome,
      prob: alpha / (alpha + beta),
      lower: betaLowerBound(alpha, beta, LOWER_BOUND_Z),
      evidence: e.s + e.f,
      n: e.n,
    };
  });
}

export function backtest(
  designated: Designated[],
  people: Person[],
  params: ModelParams,
  warmupDays: number = WARMUP_DAYS,
): BacktestResult {
  const resolved = designated.filter((d) => outcomeValue(d.status) !== null);
  if (resolved.length === 0) return { logLoss: 0, brier: 0, n: 0 };
  const first = resolved.map((d) => d.data).sort()[0];
  const evalFrom = addDays(first, warmupDays);

  const byDate = new Map<string, Designated[]>();
  for (const d of resolved) {
    if (d.data < evalFrom) continue;
    const list = byDate.get(d.data) ?? [];
    list.push(d);
    byDate.set(d.data, list);
  }

  let logLoss = 0;
  let brier = 0;
  let n = 0;
  for (const [date, rows] of byDate) {
    const probs = new Map(predictProbs(resolved, people, date, params).map((p) => [p.person_id, p.prob]));
    for (const r of rows) {
      const p = probs.get(r.person_id);
      if (p === undefined) continue;
      const y = outcomeValue(r.status)!;
      const q = Math.min(1 - LOSS_CLAMP, Math.max(LOSS_CLAMP, p));
      logLoss += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
      brier += (p - y) * (p - y);
      n++;
    }
  }
  return n === 0 ? { logLoss: 0, brier: 0, n: 0 } : { logLoss: logLoss / n, brier: brier / n, n };
}

export function fitModel(designated: Designated[], people: Person[]): ModelFit {
  const resolvedCount = designated.filter((d) => outcomeValue(d.status) !== null).length;
  const baselineParams: ModelParams = { halfLifeDays: DEFAULT_MODEL_PARAMS.halfLifeDays, priorStrength: 1e9 };
  if (resolvedCount < MIN_ROWS_TO_FIT) {
    return {
      params: DEFAULT_MODEL_PARAMS,
      model: backtest(designated, people, DEFAULT_MODEL_PARAMS),
      baseline: backtest(designated, people, baselineParams),
      fitted: false,
    };
  }
  let best: { params: ModelParams; result: BacktestResult } | null = null;
  for (const halfLifeDays of HALF_LIFE_GRID) {
    for (const priorStrength of PRIOR_GRID) {
      const params = { halfLifeDays, priorStrength };
      const result = backtest(designated, people, params);
      if (result.n === 0) continue;
      if (best === null || result.logLoss < best.result.logLoss - 1e-9) best = { params, result };
    }
  }
  if (best === null) {
    return {
      params: DEFAULT_MODEL_PARAMS,
      model: backtest(designated, people, DEFAULT_MODEL_PARAMS),
      baseline: backtest(designated, people, baselineParams),
      fitted: false,
    };
  }
  return {
    params: best.params,
    model: best.result,
    baseline: backtest(designated, people, baselineParams),
    fitted: true,
  };
}
