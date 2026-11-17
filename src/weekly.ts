import type { Designated, Person } from './types';
import { addDays } from './time';
import { predictProbs, outcomeValue, type ModelFit } from './model';

export type Change = 'up' | 'down' | 'none' | 'nodata';

export interface WeeklyRow {
  person_id: string;
  nome: string;
  ferias: boolean;
  prob: number;
  lower: number;
  baseline: number;
  weekRate: number | null;
  n: number;
  done: number;
  late: number;
  missed: number;
  z: number;
  pImproved: number;
  change: Change;
}

export interface WeeklyBoard {
  from: string;
  to: string;
  rows: WeeklyRow[];
  improved: WeeklyRow[];
  worsened: WeeklyRow[];
  lowChance: string[];
  houseWeek: number | null;
  houseBefore: number;
  totals: { assigned: number; done: number; late: number; missed: number };
  fit: ModelFit;
}

export const MIN_WEEK_TASKS = 2;
export const IMPROVED_AT = 0.9;
export const WORSENED_AT = 0.1;
export const LOW_CHANCE_BELOW = 0.5;
const TOP_MOVERS = 3;

export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z >= 0 ? 1 - p : p;
}

function betaVariance(alpha: number, beta: number): number {
  const n = alpha + beta;
  return (alpha * beta) / (n * n * (n + 1));
}

export function computeWeekly(
  designated: Designated[],
  people: Person[],
  today: string,
  fit: ModelFit,
  days = 7,
  onlyPersonId?: string,
): WeeklyBoard {
  const from = addDays(today, -days);
  const to = addDays(today, -1);
  const now = predictProbs(designated, people, today, fit.params);
  const before = predictProbs(designated, people, from, fit.params);
  const kappa = fit.params.priorStrength;

  const inWindow = (d: Designated) => d.data >= from && d.data <= to && outcomeValue(d.status) !== null;
  const active = people.filter((p) => p.ativo);
  const activeIds = new Set(active.map((p) => p.person_id));
  const windowRows = designated.filter((d) => inWindow(d) && activeIds.has(d.person_id));
  const houseN = windowRows.length;
  const houseS = windowRows.reduce((s, d) => s + (outcomeValue(d.status) as number), 0);
  const priorMean = before[0]?.priorMean ?? 0.8;
  const houseShift = houseN === 0 ? 0 : houseS / houseN - priorMean;

  const rows: WeeklyRow[] = active
    .filter((p) => !onlyPersonId || p.person_id === onlyPersonId)
    .map((p) => {
      const cur = now.find((x) => x.person_id === p.person_id)!;
      const base = before.find((x) => x.person_id === p.person_id)!;
      const week = designated.filter((d) => d.person_id === p.person_id && inWindow(d));
      const s = week.reduce((acc, d) => acc + (outcomeValue(d.status) as number), 0);
      const n = week.length;

      let z = 0;
      let pImproved = 0.5;
      let change: Change = 'nodata';
      if (n >= MIN_WEEK_TASKS) {
        const aw = kappa * priorMean + s;
        const bw = kappa * (1 - priorMean) + (n - s);
        const mw = aw / (aw + bw);
        const mb = base.alpha / (base.alpha + base.beta);
        z = (mw - mb - houseShift) / Math.sqrt(betaVariance(aw, bw) + betaVariance(base.alpha, base.beta));
        pImproved = normalCdf(z);
        change = pImproved >= IMPROVED_AT ? 'up' : pImproved <= WORSENED_AT ? 'down' : 'none';
      }

      return {
        person_id: p.person_id,
        nome: p.nome,
        ferias: p.ferias,
        prob: cur.prob,
        lower: cur.lower,
        baseline: base.prob,
        weekRate: n === 0 ? null : s / n,
        n,
        done: week.filter((d) => d.status === 'done').length,
        late: week.filter((d) => d.status === 'late').length,
        missed: week.filter((d) => d.status === 'missed').length,
        z,
        pImproved,
        change,
      };
    })
    .sort((a, b) => b.prob - a.prob || a.nome.localeCompare(b.nome));

  const improved = rows
    .filter((r) => r.change === 'up')
    .sort((a, b) => b.z - a.z || a.nome.localeCompare(b.nome))
    .slice(0, TOP_MOVERS);
  const worsened = rows
    .filter((r) => r.change === 'down')
    .sort((a, b) => a.z - b.z || a.nome.localeCompare(b.nome))
    .slice(0, TOP_MOVERS);

  const ids = new Set(rows.map((r) => r.person_id));
  const own = windowRows.filter((d) => ids.has(d.person_id));
  const totals = {
    assigned: own.length,
    done: own.filter((d) => d.status === 'done').length,
    late: own.filter((d) => d.status === 'late').length,
    missed: own.filter((d) => d.status === 'missed').length,
  };

  return {
    from,
    to,
    rows,
    improved,
    worsened,
    lowChance: rows.filter((r) => r.prob < LOW_CHANCE_BELOW).map((r) => r.nome),
    houseWeek: houseN === 0 ? null : houseS / houseN,
    houseBefore: priorMean,
    totals,
    fit,
  };
}
