import type { GenericTask, Task, AutoTask, Designated, Intent, ResolveResult } from "./types";
import { normalizeText } from "./parser";
import { addDays } from "./time";

export function sortGenericTask(
    tasks: GenericTask[],
): GenericTask[] {
    return [...tasks].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'normal' ? -1 : 1;
        return a.task_id.localeCompare(b.task_id);
    }
    );
}

export function taskToGeneric(
    task: Task,
): GenericTask {
    const generic: GenericTask = {
        __row: task.__row,
        task_id: task.task_id,
        descricao: task.descricao,
        data: task.data,
        person_id: task.person_id,
        kind: 'normal',
        status: task.status
    };
    return generic;
}

export function designatedToGeneric(
    designated: Designated,
    autoTask: AutoTask[],
): GenericTask {
    const desc = autoTask.find((a) => a.task_id === designated.task_id)?.descricao ?? '';
    const generic: GenericTask = {
        __row: designated.__row,
        task_id: designated.task_id,
        descricao: desc,
        data: designated.data,
        person_id: designated.person_id,
        kind: 'auto',
        status: designated.status
    };
    return generic;
}

export function buildCombinedList(
    tasks: Task[], // already filtered
    designated: Designated[], // already filtered
    autoTasks: AutoTask[], 
): GenericTask[] {
    const normalToGnr = tasks.map((t) => taskToGeneric(t));
    const autoToGnr = designated.map((d) => designatedToGeneric(d, autoTasks));
    return sortGenericTask([...normalToGnr,...autoToGnr]);
}

export function genericTaskKey (
    genTask: GenericTask[],
): string {
    const sortedIds = genTask.map((g) => g.task_id).sort((a, b) => a.localeCompare(b));
    return sortedIds.join(',')
}

export function resolveTargets(
  intent: Extract<Intent, { type: 'done' | 'skip' }>,
  pending: GenericTask[],
): ResolveResult {
  const base: ResolveResult = {
    targets: [],
    invalidNumbers: [],
    ambiguous: [],
    markedAll: false,
    emptyList: false,
  };

  if (pending.length === 0) return { ...base, emptyList: true };

  // Texto livre
  if (intent.query) {
    const { match, ambiguous } = findTaskByDescription(pending, intent.query);
    if (match) return { ...base, targets: [match] };
    return { ...base, ambiguous };
  }

  // Índices
  if (intent.indices && intent.indices.length > 0) {
    const targets: GenericTask[] = [];
    const invalid: number[] = [];
    for (const n of intent.indices) {
      const t = pending[n - 1];
      if (t) targets.push(t);
      else invalid.push(n);
    }
    return { ...base, targets, invalidNumbers: invalid };
  }

  // Sem argumento (ex.: "feito")
  if (pending.length === 1) return { ...base, targets: [pending[0]] };
  // Várias pendentes -> marca todas, deixando explícito na resposta.
  return { ...base, targets: [...pending], markedAll: true };
}

export function findTaskByDescription(
  pending: GenericTask[],
  query: string,
): { match?: GenericTask; ambiguous: GenericTask[] } {
  const q = normalizeText(query);
  if (!q) return { ambiguous: [] };
  const qTokens = q.split(' ').filter(Boolean);

  const scored = pending
    .map((t) => {
      const desc = normalizeText(t.descricao);
      const descTokens = new Set(desc.split(' ').filter(Boolean));
      const allTokensPresent = qTokens.every((tok) => desc.includes(tok));
      const overlap = qTokens.filter((tok) => descTokens.has(tok)).length;
      let score = 0;
      if (desc === q) score = 100;
      else if (allTokensPresent) score = 60 + overlap;
      else if (desc.includes(q)) score = 40;
      else score = overlap;
      return { task: t, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { ambiguous: [] };
  if (scored.length === 1) return { match: scored[0].task, ambiguous: [] };
  if (scored[0].score > scored[1].score) return { match: scored[0].task, ambiguous: [] };

  const top = scored.filter((s) => s.score === scored[0].score).map((s) => s.task);
  return { ambiguous: top };
}

export function buildWeekCalendar(
  tasks: Task[],
  designated: Designated[],
  autoTasks: AutoTask[],
  person_id: string,
  today: string,
  logicalToday: string,
): { data: string; descricoes: string[] }[] {
  const personTasks = tasks.filter(
    (t) => t.person_id === person_id && t.status !== 'cancelled',
  );
  const personAutos = designated.filter(
    (d) => d.person_id === person_id && d.status === 'pending' && d.data >= logicalToday,
  );
  const descOf = (task_id: string) =>
    autoTasks.find((a) => a.task_id === task_id)?.descricao || task_id;

  const days: { data: string; descricoes: string[] }[] = [];

  for (let offset = 0; offset <= 6; offset++) {
    const date = addDays(today, offset);
    const normais = personTasks
      .filter((t) => {
        if (t.periodicidade === 'daily') return !t.data || t.data <= date;
        if (t.periodicidade === 'weekly') {
          if (!t.data) return false; 
          if (t.data > today) return t.data === date;
          const renewal = addDays(t.data, 7);
          const display = renewal < today ? today : renewal; 
          return display === date;
        }
        return t.status === 'pending' && t.data === date;
      })
      .sort((a, b) => a.task_id.localeCompare(b.task_id));

    const autos = personAutos
      .filter((d) => d.data === date)
      .sort((a, b) => a.task_id.localeCompare(b.task_id));

    const descricoes = [
      ...normais.map((t) => t.descricao),
      ...autos.map((d) => descOf(d.task_id)),
    ];
    if (descricoes.length > 0) days.push({ data: date, descricoes });
  }

  return days;
}