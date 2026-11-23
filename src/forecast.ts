import type { AutoTask, Designated, Person } from './types';
import type { DaySelector } from './autotask';
import { addDays } from './time';
import { LOAD_WINDOW_DAYS } from './assign';

export interface ForecastEntry {
  data: string;
  task_id: string;
  person_id: string;
  prob: number;
}

export interface ForecastInput {
  pool: Person[];
  autoTasks: AutoTask[];
  designated: Designated[];
  probs: Map<string, number>;
  today: string;
  selector: DaySelector;
  seed: number;
  samples?: number;
  days?: number;
  fallbackProb?: number;
}

export const FORECAST_SAMPLES = 300;
export const FORECAST_DAYS = 7;
const MIN_REPORTED_PROB = 0.01;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function forecastWeek(input: ForecastInput): ForecastEntry[] {
  const { pool, autoTasks, designated, probs, today, selector, seed } = input;
  const samples = input.samples ?? FORECAST_SAMPLES;
  const days = input.days ?? FORECAST_DAYS;
  const fallback = input.fallbackProb ?? 0.8;
  const taskIds = autoTasks.map((t) => t.task_id);

  const base = designated.filter((d) => d.data < today);
  const live = designated.filter((d) => d.data >= today);
  const tally = new Map<string, number>();

  for (let s = 0; s < samples; s++) {
    const rng = mulberry32(seed + s * 7919);
    const mutable: Designated[] = live.map((d) => ({ ...d }));
    const working: Designated[] = [...base, ...mutable];

    for (let i = 0; i < days; i++) {
      const day = addDays(today, i);
      if (i > 0) {
        const prev = addDays(today, i - 1);
        for (const r of mutable) {
          if (r.data === prev && r.status === 'pending') {
            r.status = rng() < (probs.get(r.person_id) ?? fallback) ? 'done' : 'missed';
          }
        }
      }

      const present = new Set(mutable.filter((d) => d.data === day).map((d) => d.task_id));
      const missing = taskIds.filter((t) => !present.has(t));
      if (taskIds.length > 0 && missing.length === taskIds.length) {
        const made = selector(pool, autoTasks, working, day, addDays(day, -LOAD_WINDOW_DAYS));
        for (const m of made) {
          working.push(m);
          mutable.push(m);
        }
      }

      for (const r of mutable) {
        if (r.data !== day || r.status !== 'pending') continue;
        const key = `${r.data}|${r.task_id}|${r.person_id}`;
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
    }
  }

  const out: ForecastEntry[] = [];
  for (const [key, count] of tally) {
    const prob = count / samples;
    if (prob < MIN_REPORTED_PROB) continue;
    const [data, task_id, person_id] = key.split('|');
    out.push({ data, task_id, person_id, prob });
  }
  return out.sort((a, b) =>
    a.data.localeCompare(b.data) ||
    a.task_id.localeCompare(b.task_id) ||
    a.person_id.localeCompare(b.person_id));
}
