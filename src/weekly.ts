import type { Designated, Person } from './types';
import { addDays } from './time';
import { predictProbs, outcomeValue, type ModelFit } from './model';

export interface WeeklyRow {
  person_id: string;
  nome: string;
  ferias: boolean;
  prob: number;
  lower: number;
  prev: number;
  delta: number;
  done: number;
  late: number;
  missed: number;
}

export interface WeeklyBoard {
  from: string;
  to: string;
  rows: WeeklyRow[];
  improved: WeeklyRow[];
  worsened: WeeklyRow[];
  lowChance: string[];
  totals: { assigned: number; done: number; late: number; missed: number };
  fit: ModelFit;
}

export const MIN_MEANINGFUL_DELTA = 0.01;
export const LOW_CHANCE_BELOW = 0.5;
const TOP_MOVERS = 3;

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

  const rows: WeeklyRow[] = people
    .filter((p) => p.ativo && (!onlyPersonId || p.person_id === onlyPersonId))
    .map((p) => {
      const cur = now.find((x) => x.person_id === p.person_id)!;
      const prev = before.find((x) => x.person_id === p.person_id)!;
      const week = designated.filter((d) => d.person_id === p.person_id && d.data >= from && d.data <= to);
      return {
        person_id: p.person_id,
        nome: p.nome,
        ferias: p.ferias,
        prob: cur.prob,
        lower: cur.lower,
        prev: prev.prob,
        delta: cur.prob - prev.prob,
        done: week.filter((d) => d.status === 'done').length,
        late: week.filter((d) => d.status === 'late').length,
        missed: week.filter((d) => d.status === 'missed').length,
      };
    })
    .sort((a, b) => b.prob - a.prob || a.nome.localeCompare(b.nome));

  const improved = rows
    .filter((r) => r.delta >= MIN_MEANINGFUL_DELTA)
    .sort((a, b) => b.delta - a.delta || a.nome.localeCompare(b.nome))
    .slice(0, TOP_MOVERS);
  const worsened = rows
    .filter((r) => r.delta <= -MIN_MEANINGFUL_DELTA)
    .sort((a, b) => a.delta - b.delta || a.nome.localeCompare(b.nome))
    .slice(0, TOP_MOVERS);

  const assignedRows = designated.filter(
    (d) => d.data >= from && d.data <= to && outcomeValue(d.status) !== null && rows.some((r) => r.person_id === d.person_id),
  );
  const totals = {
    assigned: assignedRows.length,
    done: assignedRows.filter((d) => d.status === 'done').length,
    late: assignedRows.filter((d) => d.status === 'late').length,
    missed: assignedRows.filter((d) => d.status === 'missed').length,
  };

  return {
    from,
    to,
    rows,
    improved,
    worsened,
    lowChance: rows.filter((r) => r.prob < LOW_CHANCE_BELOW).map((r) => r.nome),
    totals,
    fit,
  };
}
