import type { Designated, Person } from './types';
import { daysBetween } from './time';

export interface ScoreParams {
  halfLifeDays: number;
  missWeight: number;
  lateWeight: number;
  priorStrength: number;
  defaultMean: number;
  gamma: number;
  maxWeight: number;
  windowDays: number;
  lowerBoundZ: number;
}

export const DEFAULT_SCORE_PARAMS: ScoreParams = {
  halfLifeDays: 14,
  missWeight: 2,
  lateWeight: 0.5,
  priorStrength: 5,
  defaultMean: 0.8,
  gamma: 20,
  maxWeight: 5,
  windowDays: 90,
  lowerBoundZ: 0.84,
};

export interface PersonScore {
  person_id: string;
  nome: string;
  ativo: boolean;
  ferias: boolean;
  done: number;
  late: number;
  missed: number;
  pending: number;
  alpha: number;
  beta: number;
  mean: number;
  lower: number;
  failure: number;
  weight: number;
  evidence: number;
}

export function decayFactor(ageDays: number, halfLifeDays: number): number {
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

export function betaMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

export function betaLowerBound(alpha: number, beta: number, z: number): number {
  const n = alpha + beta;
  const sd = Math.sqrt((alpha * beta) / (n * n * (n + 1)));
  return Math.min(1, Math.max(0, betaMean(alpha, beta) - z * sd));
}

export function computeScores(
  designated: Designated[],
  people: Person[],
  today: string,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
): PersonScore[] {
  const acc = new Map<string, { a: number; b: number; done: number; late: number; missed: number; pending: number }>();
  for (const p of people) acc.set(p.person_id, { a: 0, b: 0, done: 0, late: 0, missed: 0, pending: 0 });

  for (const d of designated) {
    const entry = acc.get(d.person_id);
    if (!entry || d.data > today) continue;
    const age = daysBetween(d.data, today);
    const decay = decayFactor(age, params.halfLifeDays);
    const inWindow = age <= params.windowDays;
    if (d.status === 'done') {
      entry.a += decay;
      if (inWindow) entry.done++;
    } else if (d.status === 'late') {
      entry.a += params.lateWeight * decay;
      if (inWindow) entry.late++;
    } else if (d.status === 'missed') {
      entry.b += params.missWeight * decay;
      if (inWindow) entry.missed++;
    } else if (inWindow) {
      entry.pending++;
    }
  }

  let totalA = 0;
  let totalB = 0;
  for (const e of acc.values()) {
    totalA += e.a;
    totalB += e.b;
  }
  const houseMean = totalA + totalB > 0 ? totalA / (totalA + totalB) : params.defaultMean;
  const a0 = params.priorStrength * houseMean;
  const b0 = params.priorStrength * (1 - houseMean);

  const base = people.map((p) => {
    const e = acc.get(p.person_id)!;
    const alpha = a0 + e.a;
    const beta = b0 + e.b;
    return { p, e, alpha, beta, mean: betaMean(alpha, beta) };
  });
  const houseFailure = base.length === 0 ? 0 : base.reduce((s, x) => s + (1 - x.mean), 0) / base.length;

  return base.map(({ p, e, alpha, beta, mean }) => {
    const failure = 1 - mean;
    const weight = Math.min(params.maxWeight, Math.max(1, 1 + params.gamma * (failure - houseFailure)));
    return {
      person_id: p.person_id,
      nome: p.nome,
      ativo: p.ativo,
      ferias: p.ferias,
      done: e.done,
      late: e.late,
      missed: e.missed,
      pending: e.pending,
      alpha,
      beta,
      mean,
      lower: betaLowerBound(alpha, beta, params.lowerBoundZ),
      failure,
      weight,
      evidence: e.a + e.b,
    };
  });
}
