import { normalizeText } from './parser';
import { designatedToGeneric, findTaskByDescription } from './generictask';
import { addDays, weekdayIndex } from './time';
import type { AutoTask, Designated, Swap } from './types';

export const SWAP_TTL_MS = 60 * 60 * 1000;

export interface ParsedSwap {
  taskQuery: string;
  dayToken: string | null;
  personQuery: string;
}

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const DMY_RE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAY_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];

function weekdayOf(token: string): number {
  const t = normalizeText(token).replace(/-feira$/, '');
  const i = WEEKDAYS.indexOf(t);
  return i >= 0 ? i : WEEKDAY_ABBR.indexOf(t);
}

function isDayToken(token: string): boolean {
  const t = normalizeText(token);
  return t === 'hoje' || t === 'amanha' || t === 'ontem' || weekdayOf(t) >= 0 || DMY_RE.test(t) || ISO_RE.test(t);
}

export function parseSwapRequest(raw: string): ParsedSwap | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const first = normalizeText(tokens[0] ?? '');
  const second = normalizeText(tokens[1] ?? '');
  if (first === 'trocar' || first === 'troca') tokens.splice(0, 1);
  else if ((first === 'solicitar' || first === 'pedir') && (second === 'troca' || second === 'trocar')) tokens.splice(0, 2);
  else return null;

  if (['de', 'da', 'do'].includes(normalizeText(tokens[0] ?? ''))) tokens.shift();
  if (tokens.length < 2) return null;

  const personQuery = tokens.pop()!.replace(/^@/, '').replace(/[,:;.!?]+$/, '');
  if (!personQuery) return null;

  const lastWord = normalizeText(tokens[tokens.length - 1] ?? '');
  const prevWord = normalizeText(tokens[tokens.length - 2] ?? '');
  if (['o', 'a'].includes(lastWord) && ['para', 'pra', 'com'].includes(prevWord)) {
    tokens.pop();
    tokens.pop();
  } else if (['para', 'pra', 'pro', 'com', 'ao'].includes(lastWord)) {
    tokens.pop();
  }

  let dayToken: string | null = null;
  if (tokens.length > 0 && isDayToken(tokens[tokens.length - 1])) dayToken = tokens.pop()!;

  const taskQuery = tokens.join(' ');
  if (!taskQuery) return null;
  return { taskQuery, dayToken, personQuery };
}

function validYmd(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export function resolveSwapDate(dayToken: string, logicalToday: string): string | null {
  const t = normalizeText(dayToken);
  let result: string | null = null;
  const wd = weekdayOf(t);
  if (t === 'hoje') result = logicalToday;
  else if (t === 'amanha') result = addDays(logicalToday, 1);
  else if (wd >= 0) result = addDays(logicalToday, (wd - weekdayIndex(logicalToday) + 7) % 7);
  else {
    const dmy = DMY_RE.exec(t);
    const iso = ISO_RE.exec(t);
    if (dmy) {
      const year = dmy[3] === undefined ? Number(logicalToday.slice(0, 4)) : dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
      result = validYmd(year, Number(dmy[2]), Number(dmy[1]));
    } else if (iso) {
      result = validYmd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    }
  }
  if (result === null || result < logicalToday) return null;
  return result;
}

export type SwapTarget =
  | { kind: 'match'; designated: Designated; descricao: string }
  | { kind: 'dates'; descricao: string; options: Designated[] }
  | { kind: 'ambiguous'; options: { designated: Designated; descricao: string }[] }
  | { kind: 'none' };

export function findSwapTarget(
  designated: Designated[],
  autoTasks: AutoTask[],
  personId: string,
  taskQuery: string,
  date: string | null,
  logicalToday: string,
): SwapTarget {
  const sorted = designated
    .filter((d) => d.person_id === personId && d.status === 'pending' && d.data >= logicalToday && (date === null || d.data === date))
    .sort((a, b) => a.data.localeCompare(b.data) || a.task_id.localeCompare(b.task_id));
  const seen = new Set<string>();
  const candidates = sorted.filter((d) => {
    if (seen.has(d.task_id)) return false;
    seen.add(d.task_id);
    return true;
  });
  const generics = candidates.map((d) => designatedToGeneric(d, autoTasks));
  const byTask = (taskId: string) => candidates.find((d) => d.task_id === taskId)!;
  const { match, ambiguous } = findTaskByDescription(generics, taskQuery);
  if (match) {
    if (date === null) {
      const all = sorted.filter((d) => d.task_id === match.task_id);
      if (all.length > 1) return { kind: 'dates', descricao: match.descricao, options: all };
    }
    return { kind: 'match', designated: byTask(match.task_id), descricao: match.descricao };
  }
  if (ambiguous.length > 0) {
    return { kind: 'ambiguous', options: ambiguous.map((g) => ({ designated: byTask(g.task_id), descricao: g.descricao })) };
  }
  return { kind: 'none' };
}

export function isSwapExpired(swap: Swap, now: Date): boolean {
  const t = Date.parse(swap.criada_em);
  if (Number.isNaN(t)) return true;
  return now.getTime() - t >= SWAP_TTL_MS;
}

function sortSwaps(list: Swap[]): Swap[] {
  return [...list].sort((a, b) => a.criada_em.localeCompare(b.criada_em) || a.swap_id.localeCompare(b.swap_id));
}

export function openSwapsFor(swaps: Swap[], paraPersonId: string, now: Date): Swap[] {
  return sortSwaps(swaps.filter((s) => s.status === 'pending' && s.para_person_id === paraPersonId && !isSwapExpired(s, now)));
}

export function openSwapsFrom(swaps: Swap[], dePersonId: string, now: Date): Swap[] {
  return sortSwaps(swaps.filter((s) => s.status === 'pending' && s.de_person_id === dePersonId && !isSwapExpired(s, now)));
}

export function hasOpenSwapFor(swaps: Swap[], target: { data: string; task_id: string }, now: Date): boolean {
  return swaps.some((s) => s.status === 'pending' && s.data === target.data && s.task_id === target.task_id && !isSwapExpired(s, now));
}

export function swapDesignated(designated: Designated[], swap: Swap): Designated | undefined {
  return designated.find((d) => d.data === swap.data && d.task_id === swap.task_id);
}

export function isSwapStale(d: Designated | undefined, swap: Swap, logicalToday: string): boolean {
  return !d || d.status !== 'pending' || d.person_id !== swap.de_person_id || d.data < logicalToday;
}

export type SwapAnswerTarget =
  | { kind: 'one'; swap: Swap }
  | { kind: 'choose'; list: Swap[] }
  | { kind: 'invalid' }
  | { kind: 'none' };

export function pickSwapAnswerTarget(open: Swap[], n?: number): SwapAnswerTarget {
  if (open.length === 0) return { kind: 'none' };
  if (n !== undefined) {
    return Number.isInteger(n) && n >= 1 && n <= open.length ? { kind: 'one', swap: open[n - 1] } : { kind: 'invalid' };
  }
  return open.length === 1 ? { kind: 'one', swap: open[0] } : { kind: 'choose', list: open };
}

export function swapsToPurge(swaps: Swap[], now: Date, days = 7): Swap[] {
  return swaps.filter((s) => {
    const t = Date.parse(s.resolvida_em || s.criada_em);
    if (Number.isNaN(t)) return false;
    return now.getTime() - t > days * 86_400_000;
  });
}
