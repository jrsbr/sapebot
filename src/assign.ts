import type { AutoTask, Designated, Person } from './types';
import { addDays, daysBetween } from './time';
import { computeScores, DEFAULT_SCORE_PARAMS, type ScoreParams } from './score';
import { countDoneByTaskPerson } from './autotask';

export interface AssignParams {
  loadPriorDays: number;
  unknownOriginDays: number;
  score: ScoreParams;
}

export const DEFAULT_ASSIGN_PARAMS: AssignParams = {
  loadPriorDays: 7,
  unknownOriginDays: 7,
  score: DEFAULT_SCORE_PARAMS,
};

export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

interface Candidate {
  person: Person;
  priority: number;
  last: string;
  tie: number;
}

export function selectDayAssignmentsV2(
  pool: Person[],
  autoTasks: AutoTask[],
  designated: Designated[],
  data: string,
  cut: string,
  params: AssignParams = DEFAULT_ASSIGN_PARAMS,
): Designated[] {
  const tasks = [...autoTasks].sort((a, b) => a.task_id.localeCompare(b.task_id));
  const k = tasks.length;
  if (k === 0 || pool.length < k) return [];

  const scores = computeScores(designated, pool, data, params.score);
  const weightOf = new Map(scores.map((s) => [s.person_id, s.weight]));

  const stats = pool.map((person) => {
    const own = designated.filter((d) => d.person_id === person.person_id && d.data < data);
    const firstSeen = own.length === 0 ? '' : own.map((d) => d.data).sort()[0];
    const origin = person.desde || firstSeen || addDays(data, -params.unknownOriginDays);
    const start = origin > cut ? origin : cut;
    const exposure = Math.max(0, daysBetween(start, data));
    const count = own.filter((d) => d.data >= start).length;
    const last = own.length === 0 ? '' : own.map((d) => d.data).sort().at(-1)!;
    return { person, exposure, count, last };
  });

  const totalExposure = stats.reduce((s, x) => s + x.exposure, 0);
  const totalCount = stats.reduce((s, x) => s + x.count, 0);
  const houseRate = totalExposure > 0 ? totalCount / totalExposure : k / pool.length;

  const candidates: Candidate[] = stats.map((x) => {
    const rate = (x.count + params.loadPriorDays * houseRate) / (x.exposure + params.loadPriorDays);
    const weight = weightOf.get(x.person.person_id) ?? 1;
    return {
      person: x.person,
      priority: rate / weight,
      last: x.last,
      tie: hashSeed(`${data}:${x.person.person_id}`),
    };
  });
  candidates.sort((a, b) =>
    a.priority - b.priority ||
    a.last.localeCompare(b.last) ||
    a.tie - b.tie ||
    a.person.person_id.localeCompare(b.person.person_id));

  const yesterday = addDays(data, -1);
  const busyYesterday = new Set(
    designated.filter((d) => d.data === yesterday).map((d) => d.person_id),
  );
  const fresh = candidates.filter((c) => !busyYesterday.has(c.person.person_id));
  const tired = candidates.filter((c) => busyYesterday.has(c.person.person_id));
  const chosen = [...fresh, ...tired].slice(0, k);

  const remaining = [...tasks];
  const result: Designated[] = [];
  for (const c of chosen) {
    let best = remaining[0];
    let bestCount = countDoneByTaskPerson(designated, c.person.person_id, best.task_id, cut);
    for (const t of remaining.slice(1)) {
      const n = countDoneByTaskPerson(designated, c.person.person_id, t.task_id, cut);
      if (n < bestCount) {
        best = t;
        bestCount = n;
      }
    }
    remaining.splice(remaining.indexOf(best), 1);
    result.push({ data, task_id: best.task_id, person_id: c.person.person_id, status: 'pending' });
  }
  return result;
}
