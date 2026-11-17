import type { AutoTask, Designated, Person } from './types';
import { addDays, daysBetween } from './time';
import { computeScores, DEFAULT_SCORE_PARAMS, type PersonScore, type ScoreParams } from './score';

export interface TaskBreakdown {
  task_id: string;
  descricao: string;
  total: number;
  done: number;
  late: number;
  missed: number;
}

export interface Streak {
  kind: 'cumpridas' | 'perdidas';
  length: number;
}

export interface PersonAnalytics {
  person_id: string;
  nome: string;
  ativo: boolean;
  ferias: boolean;
  desde: string;
  assigned: number;
  done: number;
  late: number;
  missed: number;
  pending: number;
  effectiveRate: number | null;
  onTimeRate: number | null;
  exposureDays: number;
  perWeek: number;
  lastAssigned: string | null;
  daysSinceLast: number | null;
  streak: Streak | null;
  score: PersonScore;
  tasks: TaskBreakdown[];
}

export interface HouseAnalytics {
  windowDays: number;
  people: PersonAnalytics[];
  totals: { assigned: number; done: number; late: number; missed: number; pending: number };
  effectiveRate: number | null;
  perWeekMin: number;
  perWeekMax: number;
  worstTask: TaskBreakdown | null;
  lowScore: string[];
}

export const LOW_SCORE_BELOW = 0.5;

export function effectiveRate(done: number, late: number, missed: number, lateWeight: number): number | null {
  const resolved = done + late + missed;
  return resolved === 0 ? null : (done + lateWeight * late) / resolved;
}

function currentStreak(rows: Designated[]): Streak | null {
  const resolved = rows
    .filter((d) => d.status !== 'pending')
    .sort((a, b) => b.data.localeCompare(a.data));
  if (resolved.length === 0) return null;
  const kindOf = (d: Designated): Streak['kind'] => (d.status === 'missed' ? 'perdidas' : 'cumpridas');
  const kind = kindOf(resolved[0]);
  let length = 0;
  for (const d of resolved) {
    if (kindOf(d) !== kind) break;
    length++;
  }
  return { kind, length };
}

export function computeAnalytics(
  designated: Designated[],
  people: Person[],
  autoTasks: AutoTask[],
  today: string,
  windowDays: number,
  params: ScoreParams = DEFAULT_SCORE_PARAMS,
): HouseAnalytics {
  const cut = addDays(today, -windowDays);
  const scores = computeScores(designated, people, today, params);
  const descOf = (id: string) => autoTasks.find((a) => a.task_id === id)?.descricao || id;

  const perPerson: PersonAnalytics[] = people.map((p) => {
    const rows = designated.filter((d) => d.person_id === p.person_id && d.data >= cut && d.data <= today);
    const done = rows.filter((d) => d.status === 'done').length;
    const late = rows.filter((d) => d.status === 'late').length;
    const missed = rows.filter((d) => d.status === 'missed').length;
    const pending = rows.filter((d) => d.status === 'pending').length;
    const resolved = done + late + missed;

    const start = p.desde && p.desde > cut ? p.desde : cut;
    const exposureDays = Math.max(1, daysBetween(start, today) + 1);

    const byTask = new Map<string, TaskBreakdown>();
    for (const d of rows) {
      const t = byTask.get(d.task_id) ?? { task_id: d.task_id, descricao: descOf(d.task_id), total: 0, done: 0, late: 0, missed: 0 };
      t.total++;
      if (d.status === 'done') t.done++;
      else if (d.status === 'late') t.late++;
      else if (d.status === 'missed') t.missed++;
      byTask.set(d.task_id, t);
    }

    const lastAssigned = rows.length === 0 ? null : rows.map((d) => d.data).sort().at(-1)!;

    return {
      person_id: p.person_id,
      nome: p.nome,
      ativo: p.ativo,
      ferias: p.ferias,
      desde: p.desde ?? '',
      assigned: rows.length,
      done,
      late,
      missed,
      pending,
      effectiveRate: effectiveRate(done, late, missed, params.lateWeight),
      onTimeRate: resolved === 0 ? null : done / resolved,
      exposureDays,
      perWeek: (rows.length / exposureDays) * 7,
      lastAssigned,
      daysSinceLast: lastAssigned === null ? null : daysBetween(lastAssigned, today),
      streak: currentStreak(rows),
      score: scores.find((s) => s.person_id === p.person_id)!,
      tasks: [...byTask.values()].sort((a, b) => a.descricao.localeCompare(b.descricao)),
    };
  });

  const active = perPerson.filter((p) => p.ativo);
  const totals = active.reduce(
    (acc, p) => ({
      assigned: acc.assigned + p.assigned,
      done: acc.done + p.done,
      late: acc.late + p.late,
      missed: acc.missed + p.missed,
      pending: acc.pending + p.pending,
    }),
    { assigned: 0, done: 0, late: 0, missed: 0, pending: 0 },
  );

  const taskTotals = new Map<string, TaskBreakdown>();
  for (const p of active) {
    for (const t of p.tasks) {
      const acc = taskTotals.get(t.task_id) ?? { ...t, total: 0, done: 0, late: 0, missed: 0 };
      acc.total += t.total;
      acc.done += t.done;
      acc.late += t.late;
      acc.missed += t.missed;
      taskTotals.set(t.task_id, acc);
    }
  }
  const worstTask = [...taskTotals.values()]
    .filter((t) => t.missed > 0)
    .sort((a, b) => b.missed - a.missed || a.descricao.localeCompare(b.descricao))[0] ?? null;

  const perWeek = active.map((p) => p.perWeek);

  return {
    windowDays,
    people: perPerson,
    totals,
    effectiveRate: effectiveRate(totals.done, totals.late, totals.missed, params.lateWeight),
    perWeekMin: perWeek.length ? Math.min(...perWeek) : 0,
    perWeekMax: perWeek.length ? Math.max(...perWeek) : 0,
    worstTask,
    lowScore: active.filter((p) => p.score.mean < LOW_SCORE_BELOW).map((p) => p.nome),
  };
}
