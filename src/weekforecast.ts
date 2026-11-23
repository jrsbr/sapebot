import type { AutoTask, Designated, Person } from './types';
import { loadConfig } from './sheets';
import { logger } from './logger';
import { addDays } from './time';
import { selectDayAssignments, type DaySelector } from './autotask';
import { selectDayAssignmentsV2, hashSeed } from './assign';
import { fitModel, predictProbs } from './model';
import { forecastWeek, type ForecastEntry } from './forecast';

export function configFlag(cfg: Record<string, string>, key: string, def: boolean): boolean {
  const v = cfg[key];
  if (v == null) return def;
  const s = v.trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'SIM';
}

export async function getAssignmentSelector(): Promise<DaySelector> {
  try {
    const useV2 = configFlag(await loadConfig(), 'assignment_v2_enabled', false);
    return useV2 ? selectDayAssignmentsV2 : selectDayAssignments;
  } catch (err) {
    logger.error('Falha ao ler Config; usando a regra antiga de atribuição.', { error: (err as Error).message });
    return selectDayAssignments;
  }
}

let cached: { key: number; value: ForecastEntry[] } | null = null;

function stateKey(designated: Designated[], people: Person[], today: string, selector: DaySelector): number {
  const rows = designated.map((d) => `${d.data}${d.task_id}${d.person_id}${d.status}`).join(',');
  const folks = people.map((p) => `${p.person_id}${p.ativo}${p.opt_in}${p.ferias}`).join(',');
  return hashSeed(`${today}|${selector.name}|${folks}|${rows}`);
}

export async function computeWeekForecast(
  designated: Designated[],
  people: Person[],
  autoTask: AutoTask[],
  today: string,
): Promise<ForecastEntry[]> {
  const selector = await getAssignmentSelector();
  const key = stateKey(designated, people, today, selector);
  if (cached && cached.key === key) return cached.value;

  const pool = people.filter((p) => p.ativo && p.opt_in && !p.ferias);
  const poolTasks = autoTask.filter((a) => a.tipo !== 'fixo');
  const fit = fitModel(designated, people);
  const probs = new Map(
    predictProbs(designated, people, addDays(today, 1), fit.params).map((p) => [p.person_id, p.prob]),
  );
  const value = forecastWeek({ pool, autoTasks: poolTasks, designated, probs, today, selector, seed: key });
  cached = { key, value };
  return value;
}
